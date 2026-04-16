import React from 'react';
import { Text, Box } from 'ink';
import { AnthropicClient, MessageParam, Tool, Anthropic, ContentBlock } from './llm/anthropic.js';
import { registerTools, ToolRegistry, ToolDef, ToolExecutionContext } from './tools/index.js';
import { ConsoleDisplay, type DisplayAdapter } from './utils/display.js';
import { TokenManager, TokenManagerImpl } from './services/token-manager.js';
import { CompressionService, CompressionServiceImpl } from './services/compression-service.js';
import { AgentRegistry } from './services/agent-registry.js';
import { MessageStore } from './messages.js';

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
  private store = new MessageStore();
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
  private agentRegistry?: AgentRegistry;
  private currentAgentId: string;
  private apiKey?: string;
  private baseURL?: string;
  private abortController: AbortController | null = null;
  private currentStream: import('@anthropic-ai/sdk/lib/MessageStream.js').MessageStream<null> | null = null;

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

    registerTools(this.toolRegistry, { agentRegistry: this.agentRegistry }, config.excludeTools);

    // Use provided display or create default console display
    this.display = config.display ?? new ConsoleDisplay();
    this.userPrompt = config.userPrompt || '';
  }

  /** Set or update the display adapter */
  setDisplay(display: DisplayAdapter): void {
    this.display = display;
  }

  /** Abort the current run() loop */
  abort(): void {
    this.abortController?.abort();
    this.currentStream?.abort();
  }

  private throwIfAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error('Aborted');
    }
  }

  async compress(): Promise<void> {
    const recentCount = 10;
    const contextMsgs = this.store.getInContext();
    if (contextMsgs.length <= recentCount + 2) {
      this.store.add({ role: 'status', content: '(Not enough messages to compress)', timestamp: new Date(), inContext: false });
      return;
    }

    const totalTokens = this.tokenManager.getTotal();
    this.store.add({ role: 'status', content: `(Compressing ${contextMsgs.length - recentCount} messages, ${totalTokens.toLocaleString()} tokens...)`, timestamp: new Date(), inContext: false });

    try {
      const compressed = await this.compressionService.compress(this.store.toLLMMessages(), this.client, this.model);
      const newStore = MessageStore.fromMessageParams(compressed);
      this.store.clear();
      for (const msg of newStore.getAll()) {
        this.store.add({ ...msg });
      }
      this.tokenManager.reset();
      this.display.updateTokenCount(0);
      this.store.add({ role: 'status', content: `(Compressed to ${this.store.getInContext().length} messages)`, timestamp: new Date(), inContext: false });
    } catch (e) {
      this.store.add({ role: 'error', content: `(Compression failed: ${(e as Error).message})`, timestamp: new Date(), inContext: false });
    }
  }

  /** Build system prompt with optional user/project context */
  private getSystemPrompt(): string {
    let prompt = SYSTEM_PROMPT;
    if (this.userPrompt) {
      prompt += `\n\n# Project Context\n${this.userPrompt}`;
    }
    return prompt;
  }

  /** Handle streaming response: process events, collect tool calls */
  private async handleStreamingResponse(toolDefs: Tool[]): Promise<StreamingResult> {
    const stream = this.client.chatStream(this.store.toLLMMessages(), toolDefs, {
      system: this.getSystemPrompt(),
      model: this.model,
      thinking: this.thinkingEnabled,
      thinkingTokens: this.thinkingTokens
    });
    this.currentStream = stream;

    let isStreamingThinking = false;
    let isStreamingText = false;
    const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];
    let hasToolCalls = false;
    let textMsgId = '';
    let thinkingMsgId = '';

    stream.on('thinking', (delta: string) => {
      if (!isStreamingThinking) {
        isStreamingThinking = true;
        const msg = this.store.add({ role: 'thinking', content: '', timestamp: new Date(), inContext: false, isStreaming: true });
        thinkingMsgId = msg.id;
      } else {
        const existing = this.store.get(thinkingMsgId);
        if (existing) {
          this.store.update(thinkingMsgId, { content: existing.content + delta });
        }
      }
    });

    stream.on('text', (delta: string) => {
      if (isStreamingThinking) {
        isStreamingThinking = false;
        this.store.update(thinkingMsgId, { isStreaming: false });
      }
      if (!isStreamingText) {
        isStreamingText = true;
        const msg = this.store.add({ role: 'assistant', content: '', timestamp: new Date(), inContext: true, isStreaming: true });
        textMsgId = msg.id;
      } else {
        const existing = this.store.get(textMsgId);
        if (existing) {
          this.store.update(textMsgId, { content: existing.content + delta });
        }
      }
    });

    stream.on('contentBlock', (block: ContentBlock) => {
      if (block.type === 'thinking' && isStreamingThinking) {
        isStreamingThinking = false;
        this.store.update(thinkingMsgId, { isStreaming: false });
      }
      if (block.type === 'text' && isStreamingText) {
        isStreamingText = false;
        this.store.update(textMsgId, { isStreaming: false });
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

    let response: Anthropic.Messages.Message;
    try {
      response = await stream.finalMessage();
    } catch (e) {
      this.currentStream = null;
      if (this.abortController?.signal.aborted) throw new Error('Aborted');
      throw e;
    }
    this.currentStream = null;

    if (isStreamingThinking) this.store.update(thinkingMsgId, { isStreaming: false });
    if (isStreamingText) this.store.update(textMsgId, { isStreaming: false });

    return { response, toolCalls, hasToolCalls };
  }

  /** Track token usage and trigger auto-compression */
  private async processTokenUsage(response: Anthropic.Messages.Message): Promise<void> {
    if (!response.usage) return;

    this.tokenManager.addTokens(response.usage.input_tokens, response.usage.output_tokens);
    this.display.updateTokenCount(this.tokenManager.getTotal());
    const ratio = this.tokenManager.getRatio(this.contextLength);
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    const lastShown = this.tokenManager.getLastShownThreshold();
    for (const t of thresholds) {
      if (percentage >= t && lastShown < t) {
        this.store.add({ role: 'status', content: `[${percentage}% context]`, timestamp: new Date(), inContext: false });
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

    // Add tool_call messages to store (replaces display.createSlot)
    const slots = toolCalls.map(({ block, tool }) => {
      const callElement = tool.format
        ? tool.format(block.input as Record<string, unknown>)
        : React.createElement(Text, { color: 'yellow' }, `${block.name}(${JSON.stringify(block.input)})`);
      const msg = this.store.add({
        role: 'tool_call',
        content: '',
        timestamp: new Date(),
        inContext: true,
        toolUseId: block.id,
        toolName: block.name,
        toolInput: block.input as Record<string, unknown>,
        element: callElement,
      });
      return { callElement, block, tool, msgId: msg.id };
    });

    const context: ToolExecutionContext = {
      registry: this.agentRegistry,
      signal: this.abortController?.signal,
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

    // Execute all tools in parallel, each with its own display handle
    const results = await Promise.allSettled(
      slots.map(({ block, tool, msgId, callElement }) => {
        const toolContext: ToolExecutionContext = {
          ...context,
          display: {
            update: (element: React.ReactElement) => this.store.update(msgId,
              { element: React.createElement(Box, { flexDirection: 'column' }, callElement, element) }
            )
          }
        };
        return tool.execute(block.input as Record<string, unknown>, toolContext);
      })
    );

    // Update store with final results (replaces display.updateSlot)
    results.forEach((result, i) => {
      const { block } = toolCalls[i];
      const { callElement, msgId } = slots[i];

      if (result.status === 'fulfilled') {
        const { output, display: resultElement } = result.value;
        const combined = React.createElement(Box, { flexDirection: 'column' },
          callElement,
          resultElement
        );
        this.store.update(msgId, { element: combined });
        this.store.add({
          role: 'tool_result',
          content: output,
          timestamp: new Date(),
          inContext: true,
          toolUseId: block.id,
          element: resultElement,
        });
      } else {
        const error = `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
        const errorElement = React.createElement(Text, { color: 'red' }, error);
        const combined = React.createElement(Box, { flexDirection: 'column' },
          callElement,
          errorElement
        );
        this.store.update(msgId, { element: combined });
        this.store.add({
          role: 'tool_result',
          content: error,
          timestamp: new Date(),
          inContext: true,
          toolUseId: block.id,
          element: errorElement,
        });
      }
    });
  }

  async run(userMessage: string): Promise<void> {
    this.store.add({ role: 'user', content: userMessage, timestamp: new Date(), inContext: true });
    this.abortController = new AbortController();

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

        // Assistant text was already added during streaming.
        // Mark it as finalized (not streaming) if it hasn't been already.
        this.throwIfAborted();

        // Execute tools
        await this.executeToolCalls(toolCalls);

        if (!hasToolCalls) break;
      }
    } finally {
      if (this.abortController?.signal.aborted) {
        // Remove last user message if it was the one that triggered this run
        const all = this.store.getAll();
        const last = all[all.length - 1];
        if (last?.role === 'user') {
          this.store.update(last.id, { inContext: false });
        }
      }
      this.abortController = null;
      this.currentStream = null;
    }

    // Auto-save is handled by TUI layer
  }

  // Public accessors for session management (externalized)

  /** Get LLM-formatted messages (backward compat for session save) */
  getMessages(): MessageParam[] {
    return this.store.toLLMMessages();
  }

  /** Restore messages from session (backward compat) */
  setMessages(messages: MessageParam[]): void {
    this.store = MessageStore.fromMessageParams(messages);
  }

  /** Get the underlying MessageStore */
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
    this.display.updateTokenCount(this.tokenManager.getTotal());
  }

  clearSession(): void {
    this.store.clear();
    this.tokenManager.reset();
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
