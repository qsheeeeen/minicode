import type { Model } from "./llm/model.js";
import type { MessageParam, TextBlock, ThinkingBlock } from "./messages.js";
import type { LLMToolDef, EffortLevel, LLMResponse } from "./llm/client.js";
import {
  getAll,
  getSubAgentTools,
  ToolDef,
  ToolExecutionContext,
  ToolDeniedError,
} from "./tools/index.js";
import { ToolExecutor, type ToolCall } from "./tools/executor.js";
import {
  ConsolePrompter,
  type UserPrompter,
} from "./utils/display.js";
import { Signal } from "./utils/signal.js";
import type { SessionStats } from "./services/session-stats.js";
import {
  CompressionService,
  AgentRegistry,
  PermissionService,
  type PermissionMode,
} from "./services/index.js";
import type { ContentBlock } from "./messages.js";
import { TokenTracker } from "./services/token-tracker.js";
import { ChangeJournal } from "./services/change-journal.js";
import { MessageStore } from "./messages.js";
import { PromptManager } from "./services/prompt-manager.js";
import { SessionManager } from "./services/session-manager.js";
import type pino from "pino";

export interface AgentConfig {
  model: Model;
  compressionThresholdRatio?: number;
  userPrompt?: string;
  projectPromptFile?: string;
  subAgentMode?: boolean;
  agentRegistry?: AgentRegistry;
  currentAgentId?: string;
  sessionStats?: SessionStats;
  /** Available tools. Defaults to the built-in tool set. */
  tools?: Map<string, ToolDef>;
  /** Permission mode for tool execution. */
  permissionMode?: PermissionMode;
  /** Whether to skip loading git status and environment context on init. */
  skipEnvironmentRefresh?: boolean;
}


export class Agent {
  private model: Model;
  private tools: Map<string, ToolDef>;
  private sessionManager: SessionManager;
  private compressionThresholdRatio: number;
  private tokenTracker: TokenTracker;
  private compressionService: CompressionService;
  private toolExecutor: ToolExecutor;
  public readonly tokenCount$ = new Signal(0);
  private prompter: UserPrompter;
  private promptManager: PromptManager;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private permissionService: PermissionService;
  private abortController: AbortController | null = null;
  private logger?: pino.Logger;

  private isCompressing: boolean = false;
  private isRunning: boolean = false;
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
    this.permissionService.setMode(mode);
  }

  public setModel(model: Model): void {
    this.model = model;
  }

  getModel(): Model {
    return this.model;
  }

  constructor(config: AgentConfig) {
    this.model = config.model;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.compressionService = new CompressionService();
    this.sessionManager = new SessionManager({
      sessionStats: config.sessionStats,
    });
    this.tools = config.tools
      ? new Map(config.tools)
      : config.subAgentMode
        ? getSubAgentTools()
        : getAll();
    this.agentRegistry = config.agentRegistry;
    this.currentAgentId = config.currentAgentId || "1";

    this.permissionService = new PermissionService({
      initialMode: config.permissionMode ?? "manual",
    });

    const availability = { agentRegistry: this.agentRegistry };
    for (const [name, tool] of this.tools) {
      if (tool.requires?.some((r) => !availability[r])) {
        this.tools.delete(name);
      }
    }

    this.prompter = new ConsolePrompter();
    this.toolExecutor = new ToolExecutor({
      permissionService: this.permissionService,
      changeJournal: this.sessionManager.getChangeJournal(),
      store: this.sessionManager.getStore(),
    });
    this.tokenTracker = new TokenTracker(
      this.model.getContextLength(),
      this.compressionThresholdRatio,
      this.tokenCount$,
      this.sessionManager.getStore(),
      this.sessionManager.getSessionStats(),
    );
    this.promptManager = new PromptManager({
      userPrompt: config.userPrompt,
      projectPromptFile: config.projectPromptFile,
    });
    if (!config.skipEnvironmentRefresh) {
      this.promptManager.refreshEnvironment(); // async, non-blocking
    }
  }


  setPrompter(prompter: UserPrompter): void {
    this.prompter = prompter;
    this.permissionService.setPrompter(prompter);
  }

  private async saveStore(): Promise<void> {
    await this.sessionManager.saveStore({
      model: this.model.getName(),
      totalTokens: this.tokenTracker.getTotal(),
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
    if (this.isCompressing) return;

    const recentCount = 10;
    const turns = this.sessionManager.getStore().getTurns();
    if (turns.length <= recentCount + 2) {
      this.sessionManager.getStore().addStatus({
        role: "status",
        content: "(Not enough messages to compress)",
        timestamp: new Date(),
      });
      return;
    }

    this.isCompressing = true;
    const totalTokens = this.tokenTracker.getTotal();
    this.sessionManager.getStore().addStatus({
      role: "status",
      content: `(Compressing ${turns.length - recentCount} messages, ${totalTokens.toLocaleString()} tokens...)`,
      timestamp: new Date(),
    });

    try {
      // Count original user prompts before compression
      let originalUserPrompts = 0;
      for (const t of turns) {
        if (t.role === "user" && typeof t.content === "string")
          originalUserPrompts++;
      }

      const compressed = await this.compressionService.compress(
        this.sessionManager.getStore().toLLMMessages(),
        this.model.getClient(),
        this.model.getName(),
      );

      // Count kept user prompts (excluding the summary added by compression)
      let keptUserPrompts = 0;
      for (let i = 0; i < compressed.length; i++) {
        const t = compressed[i];
        if (t.role === "user" && typeof t.content === "string")
          keptUserPrompts++;
      }
      // Summary adds 1 user prompt, so original kept = keptUserPrompts - 1
      const originalKept = keptUserPrompts - 1;
      const prunedCount = originalUserPrompts - originalKept;

      if (prunedCount > 0) {
        // Remove entries for compressed-away turns, renumber kept entries
        await this.sessionManager.getChangeJournal().pruneAndRenumber(prunedCount, 1);
      }

      this.sessionManager.getStore().setTurns(compressed);
      this.tokenTracker.reset();

      // Recalculate activeTurnIdx for the compressed conversation
      let newActiveIdx = 0;
      for (const t of compressed) {
        if (t.role === "user" && typeof t.content === "string") newActiveIdx++;
      }
      this.sessionManager.setActiveTurnIdx(newActiveIdx);
      this.sessionManager.getStore().addStatus({
        role: "status",
        content: `(Compressed to ${compressed.length} turns)`,
        timestamp: new Date(),
      });
    } catch (e) {
      this.sessionManager.getStore().addStatus({
        role: "error",
        content: `(Compression failed: ${(e as Error).message})`,
        timestamp: new Date(),
      });
    } finally {
      this.isCompressing = false;
    }
  }

  // Track token usage and trigger auto-compression
  private async processTokenUsage(response: LLMResponse): Promise<void> {
    if (!response.usage) return;

    const { shouldCompress } = this.tokenTracker.processUsage(
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
      this.sessionManager.getStore().toLLMMessages(),
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
        this.sessionManager.getStore().setStreaming(true);
        this.sessionManager.getStore().appendToLastAssistantTurn(block as ContentBlock);
      } else {
        const last = this.sessionManager.getStore().getLastBlock();
        if (last?.type === field && field in last) {
          const currentText = (field === "text" ? (last as TextBlock).text : (last as ThinkingBlock).thinking);
          const newText = currentText === "" ? delta.trimStart() : delta;
          this.sessionManager.getStore().updateLastBlock({ [field]: currentText + newText });
        } else {
          this.sessionManager.getStore().appendToLastAssistantTurn(block as ContentBlock);
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
          const tool = this.tools.get(chunk.block.name);
          toolCalls.push({ block: chunk.block, tool });
          this.sessionManager.getStore().appendToLastAssistantTurn(chunk.block as ContentBlock);
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
      this.sessionManager.getStore().setStreaming(false);
    }

    return { response, toolCalls };
  }

  async run(
    userMessage: string,
    opts?: { displayContent?: string },
  ): Promise<boolean> {
    if (this.isRunning) return false;

    this.isRunning = true;
    this.sessionManager.getStore().addUserMessage(userMessage, opts?.displayContent);

    // Count user prompts to determine current turn index
    const turns = this.sessionManager.getStore().getTurns();
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

        const toolDefs = [...this.tools.values()].map((t) => ({
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
            compressionThresholdRatio: this.compressionThresholdRatio,
            userPrompt: this.promptManager.getUserPrompt(),
          },
          currentAgentId: this.currentAgentId,
          permissionService: this.permissionService,
          prompter: this.prompter,
        };

        try {
          await this.toolExecutor.execute(toolCalls, toolContext, this.sessionManager.getActiveTurnIdx());
        } catch (e) {
          if (e instanceof ToolDeniedError) {
            this.sessionManager.getStore().addStatus({
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
        this.sessionManager.getStore().removeLastTurn(
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
          totalTokens: this.tokenTracker.getTotal(),
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
    return this.sessionManager.getStore().toLLMMessages();
  }

  // Restore messages from session. Stores turns directly — no conversion needed.
  setMessages(messages: MessageParam[]): void {
    this.sessionManager.getStore().setTurns(messages);
  }

  getStore(): MessageStore {
    return this.sessionManager.getStore();
  }

  getChangeJournal(): ChangeJournal {
    return this.sessionManager.getChangeJournal();
  }

  getTokenCount(): number {
    return this.tokenTracker.getTotal();
  }

  setTokenCount(count: number): void {
    this.tokenTracker.setCount(count);
  }

  clearSession(): void {
    this.sessionManager.clearSession();
    this.tokenTracker.reset();
  }

  getTools(): Map<string, ToolDef> {
    return this.tools;
  }

  getPermissionService(): PermissionService {
    return this.permissionService;
  }
}
