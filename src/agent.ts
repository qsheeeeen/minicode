import type { LLMClient } from "./llm/client.js";
import { createClient } from "./llm/client.js";
import type { MessageParam, ToolUseBlock, TextBlock, ThinkingBlock } from "./messages.js";
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
import { buildSystemPrompt, getEnvironmentContext } from "./utils/prompts.js";
import type pino from "pino";

export interface AgentConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  provider?: string;
  displayName?: string;
  contextLength?: number;
  compressionThresholdRatio?: number;
  thinkingEnabled?: boolean;
  effort?: EffortLevel;
  userPrompt?: string;
  projectPromptFile?: string;
  subAgentMode?: boolean;
  agentRegistry?: AgentRegistry;
  currentAgentId?: string;
  sessionStats?: SessionStats;
  /** LLM client. Defaults to creating one from model/provider config. */
  client?: LLMClient;
  /** Available tools. Defaults to the built-in tool set. */
  tools?: Map<string, ToolDef>;
  /** Permission mode for tool execution. */
  permissionMode?: PermissionMode;
  /** Whether to skip loading git status and environment context on init. */
  skipEnvironmentRefresh?: boolean;
}


export class Agent {
  private client: LLMClient;
  private tools: Map<string, ToolDef>;
  private store = new MessageStore();
  private model?: string;
  private displayName?: string;
  private modelProvider?: string;
  private contextLength: number;
  private compressionThresholdRatio: number;
  private tokenTracker: TokenTracker;
  private compressionService: CompressionService;
  private changeJournal = new ChangeJournal();
  private toolExecutor: ToolExecutor;
  private activeTurnIdx = 0;
  private _currentSession = `session-${Date.now()}`;
  get currentSession(): string {
    return this._currentSession;
  }
  private thinkingEnabled: boolean;
  private effort?: EffortLevel;
  public readonly tokenCount$ = new Signal(0);
  private prompter: UserPrompter;
  private userPrompt: string;
  private projectPromptFile: string;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private apiKey?: string;
  private baseURL?: string;
  private sessionStats?: SessionStats;
  private permissionService: PermissionService;
  private abortController: AbortController | null = null;
  private logger?: pino.Logger;

  private isCompressing: boolean = false;
  private isRunning: boolean = false;
  private clientInjected: boolean = false;
  private environmentContext = "";
  private systemPrompt = "";
  public setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.store.setSessionName(sessionName);
    this.changeJournal.startSession(MessageStore.getSessionDir(), sessionName);
  }

  public setLogger(logger: pino.Logger): void {
    this.logger = logger;
  }

  public setEffort(effort: EffortLevel): void {
    this.effort = effort;
  }

  public setPermissionMode(mode: PermissionMode): void {
    this.permissionService.setMode(mode);
  }

  public setModel(
    model: string,
    apiKey?: string,
    baseURL?: string,
    provider?: string,
    contextLength?: number,
    displayName?: string,
  ): void {
    this.model = model;
    this.displayName = displayName;
    if (provider !== undefined) this.modelProvider = provider;
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (baseURL !== undefined) this.baseURL = baseURL;
    if (contextLength !== undefined) this.contextLength = contextLength;
    if (!this.clientInjected) {
      this.client = createClient(
        this.modelProvider || "anthropic",
        this.apiKey,
        this.baseURL,
      );
    }
  }

  getModelName(): string | undefined {
    return this.displayName || this.model;
  }
  getModelProvider(): string | undefined {
    return this.modelProvider;
  }
  getContextLength(): number {
    return this.contextLength;
  }

  constructor(config: AgentConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.displayName = config.displayName;
    this.modelProvider = config.provider;
    this.contextLength = config.contextLength || 200000;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.thinkingEnabled = config.thinkingEnabled || false;
    this.effort = config.effort;
    this.compressionService = new CompressionService();
    this.tools = config.tools
      ? new Map(config.tools)
      : config.subAgentMode
        ? getSubAgentTools()
        : getAll();
    this.agentRegistry = config.agentRegistry;
    this.currentAgentId = config.currentAgentId || "1";
    this.sessionStats = config.sessionStats;

    if (config.client) {
      this.client = config.client;
      this.clientInjected = true;
    } else {
      this.client = createClient(
        this.modelProvider || "anthropic",
        this.apiKey,
        this.baseURL,
      );
    }

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
      changeJournal: this.changeJournal,
      store: this.store,
    });
    this.tokenTracker = new TokenTracker(
      this.contextLength,
      this.compressionThresholdRatio,
      this.tokenCount$,
      this.store,
      this.sessionStats,
    );
    this.userPrompt = config.userPrompt || "";
    this.projectPromptFile = config.projectPromptFile || "";

    this.refreshSystemPrompt();
    if (!config.skipEnvironmentRefresh) {
      this.refreshEnvironment(); // async, non-blocking
    }
  }


  setPrompter(prompter: UserPrompter): void {
    this.prompter = prompter;
    this.permissionService.setPrompter(prompter);
  }

  private async saveStore(): Promise<void> {
    this.store.setMeta({
      model: this.model || "unknown",
      totalTokens: this.tokenTracker.getTotal(),
    });
    await this.store.save().catch((e) => {
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
    const turns = this.store.getTurns();
    if (turns.length <= recentCount + 2) {
      this.store.addStatus({
        role: "status",
        content: "(Not enough messages to compress)",
        timestamp: new Date(),
      });
      return;
    }

    this.isCompressing = true;
    const totalTokens = this.tokenTracker.getTotal();
    this.store.addStatus({
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
        this.store.toLLMMessages(),
        this.client,
        this.model,
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
        await this.changeJournal.pruneAndRenumber(prunedCount, 1);
      }

      this.store.setTurns(compressed);
      this.tokenTracker.reset();

      // Recalculate activeTurnIdx for the compressed conversation
      let newActiveIdx = 0;
      for (const t of compressed) {
        if (t.role === "user" && typeof t.content === "string") newActiveIdx++;
      }
      this.activeTurnIdx = newActiveIdx;
      this.store.addStatus({
        role: "status",
        content: `(Compressed to ${compressed.length} turns)`,
        timestamp: new Date(),
      });
    } catch (e) {
      this.store.addStatus({
        role: "error",
        content: `(Compression failed: ${(e as Error).message})`,
        timestamp: new Date(),
      });
    } finally {
      this.isCompressing = false;
    }
  }

  private envReady = false;

  private async refreshEnvironment(): Promise<void> {
    this.environmentContext = await getEnvironmentContext();
    this.envReady = true;
    this.refreshSystemPrompt();
  }

  // Rebuild system prompt from current state
  refreshSystemPrompt(): void {
    this.systemPrompt = buildSystemPrompt({
      environmentContext: this.environmentContext,
      userPrompt: this.userPrompt,
      projectPromptFile: this.projectPromptFile,
    });
  }

  // Track token usage and trigger auto-compression
  private async processTokenUsage(response: LLMResponse): Promise<void> {
    if (!response.usage) return;

    const { shouldCompress } = this.tokenTracker.processUsage(
      this.model || "unknown",
      response.usage,
    );

    if (shouldCompress) {
      await this.compress();
    }
  }

  // Stream LLM response, updating MessageStore in real-time.
  // Returns the final response and any tool calls the LLM requested.
  private async streamLLM(toolDefs: LLMToolDef[]) {
    const stream = this.client.chatStream(
      this.store.toLLMMessages(),
      toolDefs,
      {
        system: this.systemPrompt,
        model: this.model,
        signal: this.abortController?.signal,
        effort: this.effort,
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
          const tool = this.tools.get(chunk.block.name);
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
    this.activeTurnIdx = promptCount;

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
            apiKey: this.apiKey,
            baseURL: this.baseURL,
            model: this.model,
            provider: this.modelProvider,
            contextLength: this.contextLength,
            compressionThresholdRatio: this.compressionThresholdRatio,
            thinkingEnabled: this.thinkingEnabled,
            effort: this.effort,
            userPrompt: this.userPrompt,
          },
          currentAgentId: this.currentAgentId,
          permissionService: this.permissionService,
          prompter: this.prompter,
        };

        try {
          await this.toolExecutor.execute(toolCalls, toolContext, this.activeTurnIdx);
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
    return this.changeJournal;
  }

  getTokenCount(): number {
    return this.tokenTracker.getTotal();
  }

  setTokenCount(count: number): void {
    this.tokenTracker.setCount(count);
  }

  clearSession(): void {
    this.store.clear();
    this.tokenTracker.reset();
    this.changeJournal.close();
    this.changeJournal = new ChangeJournal();
  }

  getTools(): Map<string, ToolDef> {
    return this.tools;
  }

  getPermissionService(): PermissionService {
    return this.permissionService;
  }
}
