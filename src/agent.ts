import { AnthropicClient, MessageParam, Tool, Anthropic } from './llm/anthropic.js';
import { readTool, writeTool, editTool, bashTool, ToolRegistry, ToolDef } from './tools/index.js';
import { system, toolCall, toolResult, error, progress, raw, DisplayAdapter } from './utils/display.js';
import { SessionManager } from './utils/session.js';
import { TokenManager, TokenManagerImpl } from './services/token-manager.js';
import { CompressionService, CompressionServiceImpl } from './services/compression-service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const README_PATH = path.join(__dirname, '..', '..', 'README.md');

const SYSTEM_PROMPT = `You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands
- edit: Make surgical edits to files
- write: Create or overwrite files

Guidelines:
- Use bash for file operations like ls, grep, find
- Use read to examine files before editing
- Use edit for precise changes (old text must match exactly)
- Use write only for new files or complete rewrites
- When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did
- Be concise in your responses
- Show file paths clearly when working with files

Documentation:
- For minicode documentation (features, configuration, setup), read: ${README_PATH}
- Refer to it when users ask about features, configuration, or setup, or when adding custom models/providers.`;

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
  private sessionManager: SessionManager;
  private thinkingEnabled: boolean;
  private thinkingTokens: number;
  private display: DisplayAdapter;

  constructor(config: AgentConfig = {}) {
    this.client = new AnthropicClient(config.apiKey, config.baseURL);
    this.model = config.model;
    this.contextLength = config.contextLength || 200000;
    this.compressionThresholdRatio = config.compressionThresholdRatio || 0.8;
    this.thinkingEnabled = config.thinkingEnabled || false;
    this.thinkingTokens = config.thinkingTokens || 20000;
    this.sessionManager = new SessionManager();
    this.tokenManager = config.tokenManager || new TokenManagerImpl();
    this.compressionService = config.compressionService || new CompressionServiceImpl();
    this.toolRegistry = new ToolRegistry();

    // Register built-in tools
    this.toolRegistry.register(readTool as ToolDef);
    this.toolRegistry.register(writeTool as ToolDef);
    this.toolRegistry.register(editTool as ToolDef);
    this.toolRegistry.register(bashTool as ToolDef);
    // Use provided display or create default console display
    this.display = config.display || {
      system, toolCall, toolResult, error, progress, raw,
      streamStart: () => {},
      streamChunk: () => {},
      streamEnd: () => {}
    };
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
    this.messages.push({ role: 'user', content: userMessage });

    while (true) {
      const response = await this.client.chat(
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

      // 处理响应
      const assistantMsg: MessageParam = { role: 'assistant', content: [] };
      let hasToolCalls = false;

      // First pass: collect tool calls and display text
      const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];
      let textContent = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          const text = (block as any).text;
          textContent += text;
          (assistantMsg.content as any).push(block);
        } else if (block.type === 'tool_use') {
          hasToolCalls = true;
          const toolBlock = block as Anthropic.Messages.ToolUseBlock;
          (assistantMsg.content as any).push(block);

          const tool = this.toolRegistry.get(toolBlock.name);
          if (tool) {
            toolCalls.push({ block: toolBlock, tool });
          }
        }
      }

      // Stream text content first (before tool calls)
      if (textContent) {
        this.display.streamStart();
        this.display.streamChunk(textContent);
        this.display.streamEnd();
      }

      // Then display tool calls
      for (const { block, tool } of toolCalls) {
        const display = tool.format ? tool.format(block.input as any) : `${block.name} ${JSON.stringify(block.input)}`;
        this.display.toolCall(display);
      }

      // Push assistant message first (contains tool_use blocks)
      this.messages.push(assistantMsg);

      // Second pass: execute all tools in parallel
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
            if (block.name === 'read') {
              // For read tool, show summary (content is sent to LLM)
              const lines = content.split('\n').length;
              const chars = content.length;
              this.display.system(`(Read ${lines} lines, ${chars} chars)`);
            } else {
              // Show result for other tools
              this.display.toolResult(content);
            }
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

    // Auto-save after each complete exchange
    await this.saveToSession();
  }

  async loadFromSession(name: string): Promise<boolean> {
    const data = await this.sessionManager.get(name);
    if (!data) return false;

    this.messages = data.messages as MessageParam[];
    // Restore token count from session
    const totalTokens = data.totalTokens || 0;
    this.tokenManager.reset();
    // Manually set the token count by adding it
    if (totalTokens > 0) {
      this.tokenManager.addTokens(totalTokens, 0);
    }
    // Update display with restored token count
    this.display.updateTokenCount?.(this.tokenManager.getTotal());
    this.currentSession = name;
    return true;
  }

  private async saveToSession(): Promise<void> {
    await this.sessionManager.save(this.currentSession, {
      model: this.model || 'unknown',
      messages: this.messages as any,
      totalTokens: this.tokenManager.getTotal(),
      createdAt: '',
      updatedAt: ''
    });
  }

  startNewSession(name: string): void {
    this.messages = [];
    this.tokenManager.reset();
    this.currentSession = name;
  }
}
