import type { Model } from "./llm/model.js";
import type { LLMClient, LLMToolDef, LLMResponse } from "./llm/client.js";
import { contextToLLMMessages } from "./llm/context-projection.js";
import {
  type ToolDef,
  type ToolExecutionContext,
  ToolDeniedError,
} from "./tools/index.js";
import type { ToolExecutor, ToolCall } from "./tools/executor.js";
import type { UserPrompter } from "./tools/registry.js";
import type { Signal } from "./utils/signal.js";
import type { AgentRegistry } from "./services/agent-registry.js";
import type { PromptManager } from "./services/prompt-manager.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
import type { ContextStore } from "./context/index.js";
import type { AppConfig } from "./config.js";
import type { FileSystemService } from "./services/filesystem.js";
import type { ModelSwitchService } from "./services/model-switcher.js";
import type { ShellService } from "./services/shell-service.js";
import type pino from "pino";

export interface AgentOpts {
  readonly client: LLMClient;
  readonly model: Model;
  readonly sessionManager: SessionManager;
  readonly contextManager: ContextManager;
  readonly toolExecutor: ToolExecutor;
  readonly promptManager: PromptManager;
  readonly tokenCount$: Signal<number>;
  readonly agentRegistry?: AgentRegistry;
  readonly currentAgentId?: string;
  readonly appConfig: AppConfig;
  readonly modelSwitchService?: ModelSwitchService;
  readonly fileSystemService?: FileSystemService;
  readonly shellService?: ShellService;
}

export class Agent {
  public client: LLMClient;
  public model: Model;
  private sessionManager: SessionManager;
  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;
  public readonly tokenCount$: Signal<number>;
  private promptManager: PromptManager;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private readonly appConfig: AppConfig;
  private readonly modelSwitchService?: ModelSwitchService;
  private readonly fileSystemService?: FileSystemService;
  private readonly shellService?: ShellService;
  private abortController: AbortController | null = null;
  public logger?: pino.Logger;

  private _isRunning: boolean = false;

  /** Cached access to the context manager. */
  private get context(): ContextStore {
    return this.sessionManager.getContext();
  }

  get currentSession(): string {
    return this.sessionManager.getSessionName();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  constructor(opts: AgentOpts) {
    this.client = opts.client;
    this.model = opts.model;
    this.sessionManager = opts.sessionManager;
    this.contextManager = opts.contextManager;
    this.toolExecutor = opts.toolExecutor;
    this.promptManager = opts.promptManager;
    this.tokenCount$ = opts.tokenCount$;
    this.agentRegistry = opts.agentRegistry;
    this.currentAgentId = opts.currentAgentId ?? "1";
    this.appConfig = opts.appConfig;
    this.modelSwitchService = opts.modelSwitchService;
    this.fileSystemService = opts.fileSystemService;
    this.shellService = opts.shellService;
  }

  private async saveStore(): Promise<void> {
    await this.sessionManager
      .saveStore({
        model: this.model.getName(),
        totalTokens: this.contextManager.getTokenCount(),
      })
      .catch((e: unknown) => {
        this.logger?.error({ error: String(e) }, "Failed to save session");
      });
  }

  /** Report a status message via the session's StatusReporter. */
  private reportStatus(msg: {
    role: "status" | "error";
    content: string;
    timestamp: Date;
    element?: unknown;
    toolDisplay?: {
      name: string;
      input: Record<string, unknown>;
      output?: string;
    };
  }): void {
    this.sessionManager.reportStatus(msg);
  }

  abort(): void {
    this.abortController?.abort();
  }

  private throwIfAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error("Aborted");
    }
  }

  async compress(): Promise<void> {
    const newTurnIdx = await this.contextManager.compress({
      context: this.context,
      client: this.client,
      model: this.model,
      changeJournal: this.sessionManager.getChangeJournal(),
      activeTurnIdx: this.sessionManager.getActiveTurnIdx(),
      statusReporter: this.sessionManager.getStatusReporter(),
    });
    this.sessionManager.setActiveTurnIdx(newTurnIdx);
  }

  // Track token usage and trigger auto-compression
  private async processTokenUsage(response: LLMResponse): Promise<void> {
    if (!response.usage) return;

    const shouldCompress = this.contextManager.processTokenUsage(
      this.model.getName(),
      response.usage,
    );

    if (shouldCompress) {
      await this.compress();
    }
  }

  // Stream LLM response, updating context in real-time.
  // Returns the final response and any tool calls the LLM requested.
  private async streamLLM(toolDefs: LLMToolDef[]) {
    const stream = this.client.chatStream(
      contextToLLMMessages(this.context.getTurns()),
      toolDefs,
      {
        system: this.promptManager.getSystemPrompt(),
        model: this.model,
        signal: this.abortController?.signal,
      },
    );

    const toolCalls: ToolCall[] = [];

    const handleDelta = (field: "text" | "thinking", delta: string) => {
      if (field === "thinking") this.context.appendThinking(delta);
      else this.context.appendAssistantText(delta);
    };

    let response: LLMResponse | undefined;
    try {
      while (true) {
        if (this.abortController?.signal.aborted) throw new Error("Aborted");

        const next = await stream.next();
        if (next.done) {
          response = next.value as LLMResponse;
          break;
        }

        const chunk = next.value;
        if (chunk.type === "text" || chunk.type === "thinking") {
          // @ts-expect-error - text or thinking fields exist based on type
          handleDelta(chunk.type, chunk[chunk.type]);
        } else if (chunk.type === "tool_use") {
          const tool = this.toolExecutor.getTools().get(chunk.block.name);
          toolCalls.push({ block: chunk.block, tool });
          this.context.startToolCall(
            chunk.block.id,
            chunk.block.name,
            chunk.block.input,
          );
          this.saveStore();
        }
      }

      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      if (!response)
        throw new Error("Stream closed without returning a response");
    } catch (e) {
      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      throw e;
    } finally {
      this.saveStore();
    }

    return { response, toolCalls };
  }

  async run(
    userMessage: string,
    opts?: { displayContent?: string; prompter?: UserPrompter },
  ): Promise<boolean> {
    if (this._isRunning) return false;

    this._isRunning = true;
    this.context.startTurn(userMessage);
    this.sessionManager.setActiveTurnIdx(this.context.getTurnCount());

    this.abortController = new AbortController();
    this.logger?.info(
      { session: this.currentSession, userMessage },
      "Session started",
    );

    try {
      while (true) {
        this.throwIfAborted();

        const toolDefs = [...this.toolExecutor.getTools().values()].map(
          (t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          }),
        ) as LLMToolDef[];

        const { response, toolCalls } = await this.streamLLM(toolDefs);

        await this.processTokenUsage(response);
        this.logger?.info(
          {
            session: this.currentSession,
            input: response.usage?.input,
            output: response.usage?.output,
            stopReason: response.stop_reason,
          },
          "LLM response",
        );

        this.throwIfAborted();

        const toolContext: ToolExecutionContext = {
          registry: this.agentRegistry,
          signal: this.abortController?.signal,
          config: {
            client: this.client,
            model: this.model,
            userPrompt: this.promptManager.getUserPrompt(),
          },
          appConfig: this.appConfig,
          currentAgentId: this.currentAgentId,
          prompter: opts?.prompter,
          services: {
            fs: this.fileSystemService,
            modelSwitcher: this.modelSwitchService,
            shell: this.shellService,
          },
        };

        try {
          await this.toolExecutor.execute(
            toolCalls,
            toolContext,
            this.sessionManager.getActiveTurnIdx(),
          );
        } catch (e) {
          if (e instanceof ToolDeniedError) {
            this.reportStatus({
              role: "error",
              content: `Tool "${e.toolName}" was denied by user`,
              timestamp: new Date(),
            });
            break;
          }
          throw e;
        }

        if (toolCalls.length > 0) {
          await this.saveStore();
        }

        if (toolCalls.length === 0) break;
      }
    } finally {
      this._isRunning = false;
      if (this.abortController?.signal.aborted) {
        // Remove the last user message that triggered this aborted run
        this.context.removeLastTurn((last) => last.userText === userMessage);
      }
      this.abortController = null;
      this.logger?.info(
        {
          session: this.currentSession,
          totalTokens: this.contextManager.getTokenCount(),
        },
        "Session ended",
      );
      await this.saveStore();
    }
    return true;
  }

  clearSession(): void {
    this.sessionManager.clearSession();
    this.contextManager.reset();
  }
}
