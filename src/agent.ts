import type { Model } from "./llm/model.js";
import type { MessageParam, TextBlock, ThinkingBlock, MessageStore } from "./messages.js";
import type { LLMToolDef, EffortLevel, LLMResponse } from "./llm/client.js";
import {
  type ToolDef,
  type ToolExecutionContext,
  ToolDeniedError,
} from "./tools/index.js";
import type { ToolExecutor, ToolCall } from "./tools/executor.js";
import {
  ConsolePrompter,
  type UserPrompter,
} from "./utils/display.js";
import type { Signal } from "./utils/signal.js";
import { type PermissionMode, type PermissionService } from "./services/permission.js";
import type { AgentRegistry } from "./services/agent-registry.js";
import type { ChangeJournal } from "./services/change-journal.js";
import type { ContentBlock } from "./messages.js";
import type { PromptManager } from "./services/prompt-manager.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
import type pino from "pino";

export interface AgentOpts {
  readonly model: Model;
  readonly sessionManager: SessionManager;
  readonly contextManager: ContextManager;
  readonly toolExecutor: ToolExecutor;
  readonly promptManager: PromptManager;
  readonly tokenCount$: Signal<number>;
  readonly agentRegistry?: AgentRegistry;
  readonly currentAgentId?: string;
}

export class Agent {
  private model: Model;
  private sessionManager: SessionManager;
  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;
  public readonly tokenCount$: Signal<number>;
  private prompter: UserPrompter;
  private promptManager: PromptManager;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private abortController: AbortController | null = null;
  private logger?: pino.Logger;

  private isRunning: boolean = false;

  /** Cached access to the message store. */
  private get store(): MessageStore {
    return this.sessionManager.getStore();
  }

  get currentSession(): string {
    return this.sessionManager.getSessionName();
  }
  public setSession(sessionName: string): void {
    this.sessionManager.setSession(sessionName);
  }

  public setLogger(logger: pino.Logger): void {
    this.logger = logger;
  }

  public setEffort(effort: EffortLevel): void {
    this.model.setEffort(effort);
  }

  public setPermissionMode(mode: PermissionMode): void {
    this.toolExecutor.setPermissionMode(mode);
  }

  public setModel(model: Model): void {
    this.model = model;
  }

  getModel(): Model {
    return this.model;
  }

  constructor(opts: AgentOpts) {
    this.model = opts.model;
    this.sessionManager = opts.sessionManager;
    this.contextManager = opts.contextManager;
    this.toolExecutor = opts.toolExecutor;
    this.promptManager = opts.promptManager;
    this.tokenCount$ = opts.tokenCount$;
    this.agentRegistry = opts.agentRegistry;
    this.currentAgentId = opts.currentAgentId ?? "1";
    this.prompter = new ConsolePrompter();
  }


  setPrompter(prompter: UserPrompter): void {
    this.prompter = prompter;
  }

  private async saveStore(): Promise<void> {
    await this.sessionManager.saveStore({
      model: this.model.getName(),
      totalTokens: this.contextManager.getTokenCount(),
    }).catch((e: unknown) => {
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

  async compress(): Promise<void> {
    const newTurnIdx = await this.contextManager.compress({
      store: this.store,
      model: this.model,
      changeJournal: this.sessionManager.getChangeJournal(),
      activeTurnIdx: this.sessionManager.getActiveTurnIdx(),
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

  // Stream LLM response, updating MessageStore in real-time.
  // Returns the final response and any tool calls the LLM requested.
  private async streamLLM(toolDefs: LLMToolDef[]) {
    const stream = this.model.getClient().chatStream(
      this.store.toLLMMessages(),
      toolDefs,
      {
        system: this.promptManager.getSystemPrompt(),
        model: this.model.getName(),
        signal: this.abortController?.signal,
        effort: this.model.getEffort(),
      },
    );

    let blockStreaming = false;
    const toolCalls: ToolCall[] = [];

    const handleDelta = (field: "text" | "thinking", delta: string) => {
      const block =
        field === "thinking"
          ? { type: "thinking" as const, thinking: delta.trimStart() }
          : { type: "text" as const, text: delta.trimStart() };
      if (!blockStreaming) {
        blockStreaming = true;
        this.store.setStreaming(true);
        this.store.appendToLastAssistantTurn(block as ContentBlock);
      } else {
        const last = this.store.getLastBlock();
        if (last?.type === field && field in last) {
          const currentText = (field === "text" ? (last as TextBlock).text : (last as ThinkingBlock).thinking);
          const newText = currentText === "" ? delta.trimStart() : delta;
          this.store.updateLastBlock({ [field]: currentText + newText });
        } else {
          this.store.appendToLastAssistantTurn(block as ContentBlock);
        }
      }
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
          blockStreaming = false;
          const tool = this.toolExecutor.getTools().get(chunk.block.name);
          toolCalls.push({ block: chunk.block, tool });
          this.store.appendToLastAssistantTurn(chunk.block as ContentBlock);
          this.saveStore();
        }
      }

      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      if (!response) throw new Error("Stream closed without returning a response");
    } catch (e) {
      if (this.abortController?.signal.aborted) throw new Error("Aborted");
      throw e;
    } finally {
      this.saveStore();
      this.store.setStreaming(false);
    }

    return { response, toolCalls };
  }

  async run(
    userMessage: string,
    opts?: { displayContent?: string },
  ): Promise<boolean> {
    if (this.isRunning) return false;

    this.isRunning = true;
    this.store.addUserMessage(userMessage, opts?.displayContent);

    // Count user prompts to determine current turn index
    const turns = this.store.getTurns();
    let promptCount = 0;
    for (const t of turns) {
      if (t.role === "user" && typeof t.content === "string") promptCount++;
    }
    this.sessionManager.setActiveTurnIdx(promptCount);

    this.abortController = new AbortController();
    this.logger?.info(
      { session: this.currentSession, userMessage },
      "Session started",
    );

    try {
      while (true) {
        this.throwIfAborted();

        const toolDefs = [...this.toolExecutor.getTools().values()].map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })) as LLMToolDef[];

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
            model: this.model,
            userPrompt: this.promptManager.getUserPrompt(),
          },
          currentAgentId: this.currentAgentId,
          prompter: this.prompter,
        };

        try {
          await this.toolExecutor.execute(toolCalls, toolContext, this.sessionManager.getActiveTurnIdx());
        } catch (e) {
          if (e instanceof ToolDeniedError) {
            this.store.addStatus({
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
      this.isRunning = false;
      if (this.abortController?.signal.aborted) {
        // Remove the last user message that triggered this aborted run
        this.store.removeLastTurn(
          (last) =>
            last.role === "user" &&
            typeof last.content === "string" &&
            last.content === userMessage,
        );
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

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getMessages(): MessageParam[] {
    return this.store.toLLMMessages();
  }

  // Restore messages from session. Stores turns directly — no conversion needed.
  setMessages(messages: MessageParam[]): void {
    this.store.setTurns(messages);
  }

  getStore(): MessageStore {
    return this.store;
  }

  getChangeJournal(): ChangeJournal {
    return this.sessionManager.getChangeJournal();
  }

  getTokenCount(): number {
    return this.contextManager.getTokenCount();
  }

  setTokenCount(count: number): void {
    this.contextManager.setTokenCount(count);
  }

  clearSession(): void {
    this.sessionManager.clearSession();
    this.contextManager.reset();
  }

  getTools(): Map<string, ToolDef> {
    return this.toolExecutor.getTools();
  }

  getPermissionService(): PermissionService {
    return this.toolExecutor.getPermissionService();
  }
}
