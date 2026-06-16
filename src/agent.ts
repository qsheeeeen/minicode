import type { Model } from "./llm/model.js";
import type { LLMClient, LLMToolDef, LLMStreamResult } from "./llm/client.js";
import {
  type ToolDef,
  type ToolExecutionContext,
  ToolDeniedError,
} from "./tools/index.js";
import type { ToolExecutor, ToolCall } from "./tools/executor.js";
import type { UserPrompter } from "./tools/registry.js";
import type { AgentRegistry } from "./services/agent-registry.js";
import type { PromptManager } from "./services/prompt-manager.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
import type { AppConfig } from "./config.js";
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
  readonly agentRegistry?: AgentRegistry;
  readonly currentAgentId?: string;
  readonly appConfig: AppConfig;
  readonly modelSwitchService?: ModelSwitchService;
  readonly shellService?: ShellService;
}

export class Agent {
  public client: LLMClient;
  public model: Model;
  private sessionManager: SessionManager;
  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;
  private promptManager: PromptManager;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private readonly appConfig: AppConfig;
  private readonly modelSwitchService?: ModelSwitchService;
  private readonly shellService?: ShellService;
  private abortController: AbortController | null = null;
  public logger?: pino.Logger;

  private _isRunning: boolean = false;

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
    this.agentRegistry = opts.agentRegistry;
    this.currentAgentId = opts.currentAgentId ?? "1";
    this.appConfig = opts.appConfig;
    this.modelSwitchService = opts.modelSwitchService;
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

  abort(): void {
    this.abortController?.abort();
  }

  private throwIfAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error("Aborted");
    }
  }

  // Stream LLM response, updating context in real-time.
  // Returns the stream result and any tool calls the LLM requested.
  private async streamLLM(toolDefs: LLMToolDef[]) {
    const context = this.sessionManager.getContext();
    const stream = this.client.chatStream(context.getBlocks(), toolDefs, {
      system: this.promptManager.getSystemPrompt(),
      model: this.model,
      signal: this.abortController?.signal,
    });

    const toolCalls: ToolCall[] = [];

    const handleDelta = (field: "text" | "thinking", delta: string) => {
      if (field === "thinking") context.appendThinking(delta);
      else context.appendAssistantText(delta);
    };

    let result: LLMStreamResult | undefined;
    try {
      while (true) {
        if (this.abortController?.signal.aborted) throw new Error("Aborted");

        const next = await stream.next();
        if (next.done) {
          result = next.value as LLMStreamResult;
          break;
        }

        const chunk = next.value;
        if (chunk.type === "text" || chunk.type === "thinking") {
          // @ts-expect-error - text or thinking fields exist based on type
          handleDelta(chunk.type, chunk[chunk.type]);
        } else if (chunk.type === "tool_use") {
          const tool = this.toolExecutor.getTools().get(chunk.name);
          toolCalls.push({ block: chunk, tool });
          context.startToolCall(chunk.id, chunk.name, chunk.input);
          this.saveStore();
        }
      }

      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      if (!result) throw new Error("Stream closed without returning a result");
    } catch (e) {
      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      throw e;
    } finally {
      this.saveStore();
    }

    return { result, toolCalls };
  }

  async run(
    userMessage: string,
    opts?: { displayContent?: string; prompter?: UserPrompter },
  ): Promise<boolean> {
    if (this._isRunning) return false;

    const context = this.sessionManager.getContext();
    this._isRunning = true;
    context.startUserMessage(userMessage);
    this.sessionManager.setActiveUserMessageOrdinal(
      context.getUserMessageCount(),
    );

    this.abortController = new AbortController();
    this.logger?.info(
      { session: this.sessionManager.getSessionName(), userMessage },
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

        const { result, toolCalls } = await this.streamLLM(toolDefs);

        if (result.usage) {
          await this.contextManager.processUsage(result.usage);
        }
        this.logger?.info(
          {
            session: this.sessionManager.getSessionName(),
            input: result.usage?.input,
            output: result.usage?.output,
            stopReason: result.stop_reason,
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
          changeJournal: this.sessionManager.getChangeJournal(),
          activeUserMessageOrdinal:
            this.sessionManager.getActiveUserMessageOrdinal(),
          prompter: opts?.prompter,
          services: {
            modelSwitcher: this.modelSwitchService,
            shell: this.shellService,
          },
        };

        try {
          await this.toolExecutor.execute(
            toolCalls,
            toolContext,
            this.sessionManager.getActiveUserMessageOrdinal(),
          );
        } catch (e) {
          if (e instanceof ToolDeniedError) {
            this.sessionManager.reportStatus({
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
        context.removeFromLastUserMessage(
          (last) => last[0]?.type === "user" && last[0].text === userMessage,
        );
      }
      this.abortController = null;
      this.logger?.info(
        {
          session: this.sessionManager.getSessionName(),
          totalTokens: this.contextManager.getTokenCount(),
        },
        "Session ended",
      );
      await this.saveStore();
    }
    return true;
  }
}
