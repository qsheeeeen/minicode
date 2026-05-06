import { AnthropicClient, Anthropic, type MessageParam, type Tool, type ContentBlock, type EffortLevel } from './llm/anthropic.js';
import { registerTools, ToolRegistry, ToolDef, ToolExecutionContext, ToolDeniedError } from './tools/index.js';
import { ConsoleEvents, ConsolePrompter, type AgentEvents, type UserPrompter } from './utils/display.js';
import { TokenManager, CompressionService, AgentRegistry, PermissionService, type PermissionMode } from './services/index.js';
import { MessageStore } from './messages.js';
import { skillRegistry } from './skills/index.js';
import { sessionManager } from './utils/session.js';
import { execSync } from 'child_process';
import type pino from 'pino';

export const SYSTEM_PROMPT = `你是一个交互式 CLI 工具，帮助用户完成软件工程任务。请使用以下指令和可用工具来协助用户。

# 指南：
- 使用用户的语言
- 使用 Bash 进行文件操作，如 ls、grep、find
- 编辑文件前先用 Read 查看
- 使用 Edit 进行精确修改（旧文本必须完全匹配）
- 仅在创建新文件或完全重写时使用 Write
- 总结操作时直接输出纯文本——不要用 cat 或 Bash 来展示你做了什么
- 回复保持简洁严谨——不要使用比喻
- 操作文件时清晰展示文件路径
- 在操作前评估影响范围，和用户确认不可逆的操作，用户的确认单次生效
- 你可以在单次响应中调用多个工具
- 适当地并行来提高效率`;

export interface AgentConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  contextLength?: number;
  compressionThresholdRatio?: number;
  thinkingEnabled?: boolean;
  effort?: EffortLevel;
  userPrompt?: string;
  excludeTools?: string[];
  agentRegistry?: AgentRegistry;
  currentAgentId?: string;
}

interface StreamingResult {
  response: Anthropic.Messages.Message;
  toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }>;
  hasToolCalls: boolean;
}

export class Agent {
  private client: AnthropicClient;
  private toolRegistry: ToolRegistry;
  private store = new MessageStore();
  private model?: string;
  private contextLength: number;
  private compressionThresholdRatio: number;
  private tokenManager: TokenManager;
  private compressionService: CompressionService;
  public currentSession = `session-${Date.now()}`;
  private thinkingEnabled: boolean;
  private effort?: EffortLevel;
  private events: AgentEvents;
  private prompter: UserPrompter;
  private userPrompt: string;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private apiKey?: string;
  private baseURL?: string;
  private permissionService: PermissionService;
  private abortController: AbortController | null = null;
  private currentStream: import('@anthropic-ai/sdk/lib/MessageStream.js').MessageStream<null> | null = null;
  private logger?: pino.Logger;
  private saveSessionLock: Promise<void> = Promise.resolve();
  private isCompressing: boolean = false;
  private environmentContext = '';
  private systemPrompt = '';
  private resolveCommand?: (input: string) => Promise<{ handled: boolean; promptText?: string; displayContent?: string }>;

  public setSession(sessionName: string): void {
    this.currentSession = sessionName;
  }

  public setLogger(logger: pino.Logger): void {
    this.logger = logger;
  }

  public setCommandResolver(resolver: (input: string) => Promise<{ handled: boolean; promptText?: string; displayContent?: string }>): void {
    this.resolveCommand = resolver;
  }

  public setEffort(effort: EffortLevel): void {
    this.effort = effort;
  }

  public setPermissionMode(mode: PermissionMode): void {
    this.permissionService.setMode(mode);
  }

  public setModel(model: string, apiKey?: string, baseURL?: string): void {
    this.model = model;
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (baseURL !== undefined) this.baseURL = baseURL;
    this.client = new AnthropicClient(this.apiKey, this.baseURL);
  }

  constructor(config: AgentConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.client = new AnthropicClient(this.apiKey, this.baseURL);
    this.model = config.model;
    this.contextLength = config.contextLength || 200000;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.thinkingEnabled = config.thinkingEnabled || false;
    this.effort = config.effort;
    this.tokenManager = new TokenManager();
    this.compressionService = new CompressionService();
    this.toolRegistry = new ToolRegistry();
    this.agentRegistry = config.agentRegistry;
    this.currentAgentId = config.currentAgentId || '1';
    this.permissionService = new PermissionService({
      initialMode: 'manual',
      client: this.apiKey ? this.client : undefined,
      model: this.model,
    });

    registerTools(this.toolRegistry, { agentRegistry: this.agentRegistry, skillRegistry }, config.excludeTools);

    this.events = new ConsoleEvents();
    this.prompter = new ConsolePrompter();
    this.userPrompt = config.userPrompt || '';

    this.refreshEnvironment();
    this.refreshSystemPrompt();
  }

  setEvents(events: AgentEvents): void {
    this.events = events;
  }

  setPrompter(prompter: UserPrompter): void {
    this.prompter = prompter;
    this.permissionService.setPrompter(prompter);
  }

  /** Save current session state to disk */
  private saveSession(): Promise<void> {
    this.saveSessionLock = this.saveSessionLock.then(async () => {
      await sessionManager.save(this.currentSession, {
        model: this.model || 'unknown',
        messages: this.store.toLLMMessages() as any,
        totalTokens: this.tokenManager.getTotal(),
        createdAt: '',
        updatedAt: '',
      });
    }).catch(e => {
      this.logger?.error({ error: String(e) }, 'Failed to save session');
    });

    return this.saveSessionLock;
  }

  abort(): void {
    this.abortController?.abort();
    this.currentStream?.abort();
  }

  private throwIfAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error('Aborted');
    }
  }

  private raceWithAbort<T>(promise: Promise<T>, timeoutMs = 300_000): Promise<T> {
    const ac = this.abortController;
    if (ac?.signal.aborted) return Promise.reject(new Error('Aborted'));

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const onAbort = () => {
        ac?.signal.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        done(() => reject(new Error('Aborted')));
      };
      ac?.signal.addEventListener('abort', onAbort);

      const timer = setTimeout(() => {
        ac?.signal.removeEventListener('abort', onAbort);
        done(() => reject(new Error('LLM request timed out')));
      }, timeoutMs);

      promise.then(
        (val) => { ac?.signal.removeEventListener('abort', onAbort); clearTimeout(timer); done(() => resolve(val)); },
        (err) => { ac?.signal.removeEventListener('abort', onAbort); clearTimeout(timer); done(() => reject(err)); },
      );
    });
  }

  async compress(): Promise<void> {
    if (this.isCompressing) return;

    const recentCount = 10;
    const turns = this.store.getTurns();
    if (turns.length <= recentCount + 2) {
      this.store.addStatus({ role: 'status', content: '(Not enough messages to compress)', timestamp: new Date() });
      return;
    }

    this.isCompressing = true;
    const totalTokens = this.tokenManager.getTotal();
    this.store.addStatus({ role: 'status', content: `(Compressing ${turns.length - recentCount} messages, ${totalTokens.toLocaleString()} tokens...)`, timestamp: new Date() });

    try {
      const compressed = await this.compressionService.compress(this.store.toLLMMessages(), this.client, this.model);
      this.store.setTurns(compressed);
      this.tokenManager.reset();
      this.events.tokenUpdate(0);
      this.store.addStatus({ role: 'status', content: `(Compressed to ${compressed.length} turns)`, timestamp: new Date() });
    } catch (e) {
      this.store.addStatus({ role: 'error', content: `(Compression failed: ${(e as Error).message})`, timestamp: new Date() });
    } finally {
      this.isCompressing = false;
    }
  }

  private refreshEnvironment(): void {
    let ctx = `Working directory: ${process.cwd()}\n`;
    try {
      const status = execSync('git status', { encoding: 'utf-8', timeout: 5000 });
      ctx += `\n${status.trim()}\n`;
      ctx += `\nThis is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`;
    } catch {
      // Not a git repo or git unavailable — skip
    }
    this.environmentContext = ctx;
  }

  /** Build and cache the system prompt — call once per run or on explicit refresh */
  refreshSystemPrompt(): void {
    let prompt = SYSTEM_PROMPT;

    if (this.environmentContext) {
      prompt += `\n\n# Environment\n${this.environmentContext}`;
    }

    if (this.userPrompt) {
      prompt += `\n\n# Project Context\n${this.userPrompt}`;
    }

    const availableSkills = skillRegistry.getAvailableSkills();
    if (availableSkills.length > 0) {
      prompt += `\n\n<available_skills>\n`;
      availableSkills.forEach(skill => {
        prompt += `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description}</description>\n  </skill>\n`;
      });
      prompt += `</available_skills>\n`;
      prompt += `\nTo activate a skill and receive its detailed instructions, use the ActivateSkill tool with the skill's name.\n`;
    }

    this.systemPrompt = prompt;
  }

  /** Handle streaming response: build assistant turn incrementally */
  private async handleStreamingResponse(toolDefs: Tool[]): Promise<StreamingResult> {
    const stream = this.client.chatStream(this.store.toLLMMessages(), toolDefs, {
      system: this.systemPrompt,
      model: this.model,
      signal: this.abortController?.signal,
      effort: this.effort
    });
    this.currentStream = stream;
    this.store.setStreaming(true);

    let blockStreaming = false;
    const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];
    let hasToolCalls = false;

    stream.on('thinking', (delta: string) => {
      if (!blockStreaming) {
        blockStreaming = true;
        this.store.appendToLastAssistantTurn({ type: 'thinking', thinking: delta } as ContentBlock);
      } else {
        const last = this.store.getLastBlock();
        if (last?.type === 'thinking') {
          this.store.updateLastBlock({ thinking: (last as any).thinking + delta });
        } else {
          this.store.appendToLastAssistantTurn({ type: 'thinking', thinking: delta } as ContentBlock);
        }
      }
    });

    stream.on('text', (delta: string) => {
      if (!blockStreaming) {
        blockStreaming = true;
        this.store.appendToLastAssistantTurn({ type: 'text', text: delta } as ContentBlock);
      } else {
        const last = this.store.getLastBlock();
        if (last?.type === 'text') {
          this.store.updateLastBlock({ text: (last as any).text + delta });
        } else {
          this.store.appendToLastAssistantTurn({ type: 'text', text: delta } as ContentBlock);
        }
      }
    });

    stream.on('contentBlock', (block: ContentBlock) => {
      blockStreaming = false;
      if (block.type === 'thinking' || block.type === 'text') {
        this.saveSession().catch(() => {});
      }
      if (block.type === 'tool_use') {
        hasToolCalls = true;
        const toolBlock = block as Anthropic.Messages.ToolUseBlock;
        const tool = this.toolRegistry.get(toolBlock.name);
        if (tool) {
          toolCalls.push({ block: toolBlock, tool });
        }
        this.store.appendToLastAssistantTurn({
          type: 'tool_use',
          id: toolBlock.id,
          name: toolBlock.name,
          input: toolBlock.input,
        } as ContentBlock);
        this.saveSession().catch(() => {});
      }
    });

    let response: Anthropic.Messages.Message;
    try {
      response = await this.raceWithAbort(stream.finalMessage());
    } catch (e) {
      if (this.abortController?.signal.aborted) throw new Error('Aborted');
      throw e;
    } finally {
      this.currentStream = null;
      this.store.setStreaming(false);
    }

    return { response, toolCalls, hasToolCalls };
  }

  /** Track token usage and trigger auto-compression */
  private async processTokenUsage(response: Anthropic.Messages.Message): Promise<void> {
    if (!response.usage) return;

    this.tokenManager.addTokens(
      response.usage.input_tokens,
      response.usage.output_tokens,
      response.usage.cache_creation_input_tokens ?? 0,
      response.usage.cache_read_input_tokens ?? 0,
    );
    this.events.tokenUpdate(this.tokenManager.getTotal());
    const ratio = this.tokenManager.getRatio(this.contextLength);
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    const lastShown = this.tokenManager.getLastShownThreshold();
    for (const t of thresholds) {
      if (percentage >= t && lastShown < t) {
        this.store.addStatus({ role: 'status', content: `[${percentage}% context]`, timestamp: new Date() });
        this.tokenManager.updateThreshold(t);
        break;
      }
    }

    if (this.tokenManager.shouldCompress(this.contextLength, this.compressionThresholdRatio)) {
      await this.compress();
    }
  }

  /** Run a single tool with permission check */
  private async runTool(tool: ToolDef, args: Record<string, unknown>, context: ToolExecutionContext): Promise<import('./tools/index.js').ToolResult> {
    if (tool.requiresPermission) {
      const displayText = `${tool.name}(${JSON.stringify(args)})`;
      const allowed = await this.permissionService.check(tool.name, args, displayText);
      if (!allowed) {
        throw new ToolDeniedError(tool.name, displayText);
      }
    }
    return tool.execute(args, context);
  }

  /** Execute tool calls sequentially and push tool_result turns */
  private async executeToolCalls(toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }>): Promise<void> {
    if (toolCalls.length === 0) return;

    const context: ToolExecutionContext = {
      registry: this.agentRegistry,
      skillRegistry: skillRegistry,
      signal: this.abortController?.signal,
      config: {
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        model: this.model,
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

    this.logger?.info({ session: this.currentSession, toolCount: toolCalls.length, tools: toolCalls.map(t => t.block.name) }, 'Executing tools sequentially');

    const results: Array<{ toolUseId: string; content: string }> = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const { block, tool } = toolCalls[i];
      try {
        const result = await this.runTool(tool, block.input as Record<string, unknown>, context);
        results.push({ toolUseId: block.id, content: result.output });
        this.logger?.info({ session: this.currentSession, toolName: tool.name, toolInput: block.input }, 'Tool result');
      } catch (reason) {
        if (reason instanceof ToolDeniedError) {
          results.push({ toolUseId: block.id, content: 'User rejected' });
          for (let j = i + 1; j < toolCalls.length; j++) {
            results.push({ toolUseId: toolCalls[j].block.id, content: 'User rejected' });
          }
          this.store.addToolResults(results);
          throw reason;
        }
        const error = `Error: ${reason instanceof Error ? reason.message : String(reason)}`;
        results.push({ toolUseId: block.id, content: error });
        this.logger?.error({ session: this.currentSession, toolName: tool.name, error: String(reason) }, 'Tool error');
      }
    }

    // Push all tool results as a single user turn
    this.store.addToolResults(results);
  }

  async run(userMessage: string, opts?: { displayContent?: string }): Promise<boolean> {
    // Resolve slash commands (e.g. /plan → expanded prompt, /clear → clear session)
    let llmText = userMessage;
    let displayOverride = opts?.displayContent;
    if (this.resolveCommand) {
      const resolved = await this.resolveCommand(userMessage);
      if (resolved.handled) {
        if (resolved.promptText) {
          llmText = resolved.promptText;
          displayOverride = resolved.displayContent;
        } else {
          // Handler command executed (e.g. /clear); nothing to send to LLM
          return false;
        }
      }
    }

    this.store.addUserMessage(llmText, displayOverride);
    this.abortController = new AbortController();
    this.logger?.info({ session: this.currentSession, userMessage: llmText }, 'Session started');

    try {
      while (true) {
        this.throwIfAborted();

        const toolDefs = this.toolRegistry.getAll().map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        })) as Tool[];

        const { response, toolCalls, hasToolCalls } = await this.handleStreamingResponse(toolDefs);

        await this.processTokenUsage(response);
        this.logger?.info({
          session: this.currentSession,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          cacheCreation: response.usage?.cache_creation_input_tokens ?? 0,
          cacheRead: response.usage?.cache_read_input_tokens ?? 0,
          stopReason: response.stop_reason,
        }, 'LLM response');

        this.throwIfAborted();

        try {
          await this.executeToolCalls(toolCalls);
        } catch (e) {
          if (e instanceof ToolDeniedError) {
            this.store.addStatus({
              role: 'error',
              content: `Tool "${e.toolName}" was denied by user`,
              timestamp: new Date(),
            });
            break;
          }
          throw e;
        }

        if (hasToolCalls) {
          await this.saveSession();
        }

        if (!hasToolCalls) break;
      }
    } finally {
      if (this.abortController?.signal.aborted) {
        // Remove the last user message that triggered this aborted run
        const turns = this.store.getTurns();
        const last = turns[turns.length - 1];
        if (last?.role === 'user' && typeof last.content === 'string' && last.content === llmText) {
          turns.pop();
          this.store.setTurns(turns);
        }
      }
      this.abortController = null;
      this.currentStream = null;
      this.logger?.info({ session: this.currentSession, totalTokens: this.tokenManager.getTotal() }, 'Session ended');
      await this.saveSession();
    }
    return true;
  }

  // -- Public accessors --

  getMessages(): MessageParam[] {
    return this.store.toLLMMessages();
  }

  /** Restore messages from session. Stores turns directly — no conversion needed. */
  setMessages(messages: MessageParam[]): void {
    this.store.setTurns(messages);
  }

  getStore(): MessageStore {
    return this.store;
  }

  getTokenCount(): number {
    return this.tokenManager.getTotal();
  }

  setTokenCount(count: number): void {
    this.tokenManager.reset();
    if (count > 0) {
      this.tokenManager.addTokens(count, 0);
    }
    this.events.tokenUpdate(this.tokenManager.getTotal());
  }

  clearSession(): void {
    this.store.clear();
    this.tokenManager.reset();
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getPermissionService(): PermissionService {
    return this.permissionService;
  }
}
