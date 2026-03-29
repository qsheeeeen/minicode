import { AnthropicClient, MessageParam, Tool, Anthropic } from './llm/anthropic.js';
import { readTool, writeTool, editTool, bashTool, ToolRegistry, ToolDef } from './tools/index.js';
import { ConsoleDisplay, type DisplayAdapter } from './utils/display.js';
import { TokenManager, TokenManagerImpl } from './services/token-manager.js';
import { CompressionService, CompressionServiceImpl } from './services/compression-service.js';

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
  public currentSession: string = 'default';
  private thinkingEnabled: boolean;
  private thinkingTokens: number;
  private display: DisplayAdapter;
  private userPrompt: string;
  private userPromptInjected = false;

  constructor(config: AgentConfig = {}) {
    this.client = new AnthropicClient(config.apiKey, config.baseURL);
    this.model = config.model;
    this.contextLength = config.contextLength || 200000;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.thinkingEnabled = config.thinkingEnabled || false;
    this.thinkingTokens = config.thinkingTokens || 20000;
    this.tokenManager = config.tokenManager || new TokenManagerImpl();
    this.compressionService = config.compressionService || new CompressionServiceImpl();
    this.toolRegistry = new ToolRegistry();

    // Register built-in tools
    this.toolRegistry.register(readTool as ToolDef);
    this.toolRegistry.register(writeTool as ToolDef);
    this.toolRegistry.register(editTool as ToolDef);
    this.toolRegistry.register(bashTool as ToolDef);
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

  async run(userMessage: string): Promise<void> {
    // Inject user prompt as context on first run
    if (!this.userPromptInjected && this.userPrompt) {
      this.messages.push({ role: 'user', content: this.userPrompt });
      this.messages.push({ role: 'assistant', content: 'Understood.' });
      this.userPromptInjected = true;
    }

    this.messages.push({ role: 'user', content: userMessage });

    while (true) {
      const stream = this.client.chatStream(
        this.messages,
        this.toolRegistry.getAll().map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        })) as Tool[],
        {
          system: SYSTEM_PROMPT,
          model: this.model,
          thinking: this.thinkingEnabled,
          thinkingTokens: this.thinkingTokens
        }
      );

      // Track streaming state
      let isStreamingThinking = false;
      let isStreamingText = false;
      const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];
      let hasToolCalls = false;

      // Stream thinking deltas
      stream.on('thinking', (delta: string) => {
        if (!isStreamingThinking) {
          isStreamingThinking = true;
          this.display.streamThinkingStart();
        }
        this.display.streamThinkingChunk(delta);
      });

      // Stream text deltas
      stream.on('text', (delta: string) => {
        // End thinking if still streaming
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

      // Collect completed content blocks (tool_use blocks arrive here)
      stream.on('contentBlock', (block: any) => {
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

      // Wait for stream to complete and get final message
      const response = await stream.finalMessage();

      // End any remaining streams
      if (isStreamingThinking) {
        this.display.streamThinkingEnd();
      }
      if (isStreamingText) {
        this.display.streamEnd();
      }

      // Track token usage
      if (response.usage) {
        this.tokenManager.addTokens(response.usage.input_tokens, response.usage.output_tokens);
        this.display.updateTokenCount?.(this.tokenManager.getTotal());
        const ratio = this.tokenManager.getRatio(this.contextLength);
        const percentage = Math.floor(ratio * 100);

        // Show only at 25%, 50%, 75%, 90%
        const thresholds = [25, 50, 75, 90];
        const lastShown = this.tokenManager.getLastShownThreshold();
        for (const t of thresholds) {
          if (percentage >= t && lastShown < t) {
            this.display.system(`[${percentage}% context]`);
            this.tokenManager.updateThreshold(t);
            break;
          }
        }

        // Auto-compression check
        if (this.tokenManager.shouldCompress(this.contextLength, this.compressionThresholdRatio)) {
          await this.compress();
        }
      }

      // Build assistant message from response content blocks
      const assistantMsg: MessageParam = { role: 'assistant', content: response.content as any };

      // Display tool calls
      for (const { block, tool } of toolCalls) {
        const display = tool.format ? tool.format(block.input as any) : `${block.name} ${JSON.stringify(block.input)}`;
        this.display.toolCall(display);
      }

      // Push assistant message
      this.messages.push(assistantMsg);

      // Execute tool calls in parallel
      if (toolCalls.length > 0) {
        this.display.progress(`Running ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}... `);
        const results = await Promise.allSettled(
          toolCalls.map(({ block, tool }) => tool.execute(block.input as any))
        );
        // Clear progress line
        this.display.raw('');

        // Display results and push to messages
        results.forEach((result, i) => {
          const { block, tool: _tool } = toolCalls[i];
          const content = result.status === 'fulfilled'
            ? result.value
            : `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;

          // Display tool result
          if (result.status === 'fulfilled') {
            const display = _tool.formatResult ? _tool.formatResult(content) : content;
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
}
