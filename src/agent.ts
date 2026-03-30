import { AnthropicClient, MessageParam, Tool, Anthropic, ContentBlock } from './llm/anthropic.js';
import { readTool, writeTool, editTool, bashTool, agentTool, ToolRegistry, ToolDef, ToolExecutionContext } from './tools/index.js';
import { ConsoleDisplay, type DisplayAdapter } from './utils/display.js';
import { TokenManager, TokenManagerImpl } from './services/token-manager.js';
import { CompressionService, CompressionServiceImpl } from './services/compression-service.js';
import { AgentRegistry } from './services/agent-registry.js';

export const SYSTEM_PROMPT = `You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

# Available tools
- read: Read file contents
- bash: Execute bash commands
- edit: Make surgical edits to files
- write: Create or overwrite files

# Guidelines:
- Use bash for file operations like ls, grep, find
- Use read to examine files before editing
- Use edit for precise changes (old text must match exactly)
- Use write only for new files or complete rewrites
- When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did
- Be concise in your responses
- Show file paths clearly when working with files
- Use user's language`;

export interface AgentConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  contextLength?: number;
  compressionThresholdRatio?: number;
  thinkingEnabled?: boolean;
  thinkingTokens?: number;
  display?: DisplayAdapter;
  tokenManager?: TokenManager;
  compressionService?: CompressionService;
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
  private messages: MessageParam[] = [];
  private model?: string;
  private contextLength: number;
  private compressionThresholdRatio: number;
  private tokenManager: TokenManager;
  private compressionService: CompressionService;
  public currentSession = `session-${Date.now()}`;
  private thinkingEnabled: boolean;
  private thinkingTokens: number;
  private display: DisplayAdapter;
  private userPrompt: string;
  private userPromptInjected = false;
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private apiKey?: string;
  private baseURL?: string;

  constructor(config: AgentConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.client = new AnthropicClient(this.apiKey, this.baseURL);
    this.model = config.model;
    this.contextLength = config.contextLength || 200000;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.thinkingEnabled = config.thinkingEnabled || false;
    this.thinkingTokens = config.thinkingTokens || 20000;
    this.tokenManager = config.tokenManager || new TokenManagerImpl();
    this.compressionService = config.compressionService || new CompressionServiceImpl();
    this.toolRegistry = new ToolRegistry();
    this.agentRegistry = config.agentRegistry;
    this.currentAgentId = config.currentAgentId || '1';

    // Register built-in tools (respecting excludeTools)
    const excludeTools = config.excludeTools || [];
    const builtInTools = [readTool, writeTool, editTool, bashTool] as ToolDef[];

    for (const tool of builtInTools) {
      if (!excludeTools.includes(tool.name)) {
        this.toolRegistry.register(tool);
      }
    }

    // Register agent tool only if:
    // 1. AgentRegistry is available
    // 2. agent tool is not excluded
    // This ensures only the main agent can spawn sub-agents
    if (this.agentRegistry && !excludeTools.includes('agent')) {
      this.toolRegistry.register(agentTool);
    }

    // Use provided display or create default console display
    this.display = config.display ?? new ConsoleDisplay();
    this.userPrompt = config.userPrompt || '';
  }

  /** Set or update the display adapter */
  setDisplay(display: DisplayAdapter): void {
    this.display = display;
  }

  async compress(): Promise<void> {
    const recentCount = 10;
    if (this.messages.length <= recentCount + 2) {
      this.display.system('(Not enough messages to compress)');
      return;
    }

    const totalTokens = this.tokenManager.getTotal();
    this.display.system(`(Compressing ${this.messages.length - recentCount} messages, ${totalTokens.toLocaleString()} tokens...)`);

    try {
      this.messages = await this.compressionService.compress(this.messages, this.client, this.model);
      this.tokenManager.reset();
      this.display.updateTokenCount?.(0);
      this.display.system(`(Compressed to ${this.messages.length} messages)`);
    } catch (e) {
      this.display.error(`(Compression failed: ${(e as Error).message})`);
    }
  }

  /** Inject user prompt as context on first run */
  private injectUserPrompt(): void {
    if (!this.userPromptInjected && this.userPrompt) {
      this.messages.push({ role: 'user', content: this.userPrompt });
      this.messages.push({ role: 'assistant', content: 'Understood.' });
      this.userPromptInjected = true;
    }
  }

  /** Handle streaming response: process events, collect tool calls */
  private async handleStreamingResponse(toolDefs: Tool[]): Promise<StreamingResult> {
    const stream = this.client.chatStream(this.messages, toolDefs, {
      system: SYSTEM_PROMPT,
      model: this.model,
      thinking: this.thinkingEnabled,
      thinkingTokens: this.thinkingTokens
    });

    let isStreamingThinking = false;
    let isStreamingText = false;
    const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];
    let hasToolCalls = false;

    stream.on('thinking', (delta: string) => {
      if (!isStreamingThinking) {
        isStreamingThinking = true;
        this.display.streamThinkingStart();
      }
      this.display.streamThinkingChunk(delta);
    });

    stream.on('text', (delta: string) => {
      if (isStreamingThinking) {
        isStreamingThinking = false;
        this.display.streamThinkingEnd();
      }
      if (!isStreamingText) {
        isStreamingText = true;
        this.display.streamStart();
      }
      this.display.streamChunk(delta);
    });

    stream.on('contentBlock', (block: ContentBlock) => {
      if (block.type === 'thinking' && isStreamingThinking) {
        isStreamingThinking = false;
        this.display.streamThinkingEnd();
      }
      if (block.type === 'text' && isStreamingText) {
        isStreamingText = false;
        this.display.streamEnd();
      }
      if (block.type === 'tool_use') {
        hasToolCalls = true;
        const toolBlock = block as Anthropic.Messages.ToolUseBlock;
        const tool = this.toolRegistry.get(toolBlock.name);
        if (tool) {
          toolCalls.push({ block: toolBlock, tool });
        }
      }
    });

    const response = await stream.finalMessage();

    if (isStreamingThinking) this.display.streamThinkingEnd();
    if (isStreamingText) this.display.streamEnd();

    return { response, toolCalls, hasToolCalls };
  }

  /** Track token usage and trigger auto-compression */
  private async processTokenUsage(response: Anthropic.Messages.Message): Promise<void> {
    if (!response.usage) return;

    this.tokenManager.addTokens(response.usage.input_tokens, response.usage.output_tokens);
    this.display.updateTokenCount?.(this.tokenManager.getTotal());
    const ratio = this.tokenManager.getRatio(this.contextLength);
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    const lastShown = this.tokenManager.getLastShownThreshold();
    for (const t of thresholds) {
      if (percentage >= t && lastShown < t) {
        this.display.system(`[${percentage}% context]`);
        this.tokenManager.updateThreshold(t);
        break;
      }
    }

    if (this.tokenManager.shouldCompress(this.contextLength, this.compressionThresholdRatio)) {
      await this.compress();
    }
  }

  /** Execute tool calls in parallel and push results */
  private async executeToolCalls(toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }>): Promise<void> {
    if (toolCalls.length === 0) return;

    this.display.progress(`Running ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}... `);

    const context: ToolExecutionContext = {
      registry: this.agentRegistry,
      config: {
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        model: this.model,
        contextLength: this.contextLength,
        compressionThresholdRatio: this.compressionThresholdRatio,
        thinkingEnabled: this.thinkingEnabled,
        thinkingTokens: this.thinkingTokens,
        userPrompt: this.userPrompt,
      },
      currentAgentId: this.currentAgentId,
    };

    const results = await Promise.allSettled(
      toolCalls.map(({ block, tool }) => tool.execute(block.input as Record<string, unknown>, context))
    );
    this.display.raw('');

    results.forEach((result, i) => {
      const { block, tool } = toolCalls[i];
      const content = result.status === 'fulfilled'
        ? result.value
        : `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;

      if (result.status === 'fulfilled') {
        const display = tool.formatResult ? tool.formatResult(content) : content;
        this.display.toolResult(display);
      } else {
        this.display.error(content);
      }

      this.messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: block.id,
          content
        }]
      });
    });
  }

  async run(userMessage: string): Promise<void> {
    this.injectUserPrompt();
    this.messages.push({ role: 'user', content: userMessage });

    while (true) {
      const toolDefs = this.toolRegistry.getAll().map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      })) as Tool[];

      const { response, toolCalls, hasToolCalls } = await this.handleStreamingResponse(toolDefs);

      await this.processTokenUsage(response);

      // Build and push assistant message
      const assistantMsg: MessageParam = { role: 'assistant', content: response.content as ContentBlock[] };

      // Display tool calls
      for (const { block, tool } of toolCalls) {
        const display = tool.format ? tool.format(block.input as Record<string, unknown>) : `${block.name} ${JSON.stringify(block.input)}`;
        this.display.toolCall(display);
      }

      this.messages.push(assistantMsg);

      // Execute tools
      await this.executeToolCalls(toolCalls);

      if (!hasToolCalls) break;
    }

    // Auto-save is handled by TUI layer
  }

  // Public accessors for session management (externalized)
  getMessages(): MessageParam[] {
    return this.messages;
  }

  setMessages(messages: MessageParam[]): void {
    this.messages = messages;
  }

  getTokenCount(): number {
    return this.tokenManager.getTotal();
  }

  setTokenCount(count: number): void {
    this.tokenManager.reset();
    if (count > 0) {
      this.tokenManager.addTokens(count, 0);
    }
    this.display.updateTokenCount?.(this.tokenManager.getTotal());
  }

  clearSession(): void {
    this.messages = [];
    this.tokenManager.reset();
    this.userPromptInjected = false;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
