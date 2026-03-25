import { AnthropicClient, MessageParam, Tool, Anthropic } from '../llm/anthropic.js';
import { readTool, writeTool, editTool, bashTool } from '../tools/index.js';

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
- Your own documentation (including custom model setup and theme creation) is at: /path/to/README.md
- Read it when users ask about features, configuration, or setup, and especially if the user asks you to add a custom model or provider, or create a custom theme.`;

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  format?: (args: any) => string;
  execute: (args: any) => Promise<string>;
};

export class Agent {
  private client: AnthropicClient;
  private tools: Map<string, ToolDef>;
  private messages: MessageParam[] = [];
  private model?: string;
  private contextLength: number;
  private compressionThresholdRatio: number;
  private totalTokens = 0;

  constructor(apiKey?: string, baseURL?: string, model?: string, contextLength?: number, compressionThresholdRatio?: number) {
    this.client = new AnthropicClient(apiKey, baseURL);
    this.model = model;
    this.contextLength = contextLength || 200000;
    this.compressionThresholdRatio = compressionThresholdRatio || 0.8;
    this.tools = new Map<string, ToolDef>([
      ['read', readTool as ToolDef],
      ['write', writeTool as ToolDef],
      ['edit', editTool as ToolDef],
      ['bash', bashTool as ToolDef]
    ]);
  }

  async compress(): Promise<void> {
    const recentCount = 10;
    if (this.messages.length <= recentCount + 2) {
      console.log('(Not enough messages to compress)');
      return;
    }

    console.log(`(Compressing ${this.messages.length - recentCount} messages, ${this.totalTokens.toLocaleString()} tokens...)`);

    const messagesToSummarize = this.messages.slice(0, -recentCount);
    const summaryPrompt = `Summarize the following conversation concisely. Focus on:
- What was being worked on
- Key decisions made
- Current state

Keep it brief and actionable.

Conversation:
${JSON.stringify(messagesToSummarize, null, 2)}`;

    try {
      const summary = await this.client.chat(
        [{ role: 'user', content: summaryPrompt }],
        [],
        { model: this.model, maxTokens: 1000 }
      );

      const summaryText = (summary.content[0] as any)?.text || 'Conversation summary unavailable';
      this.messages = [
        { role: 'user', content: `[Previous conversation summary]\n${summaryText}` },
        ...this.messages.slice(-recentCount)
      ];

      this.totalTokens = 0;
      console.log(`(Compressed to ${this.messages.length} messages)`);
    } catch (e) {
      console.log(`(Compression failed: ${(e as Error).message})`);
    }
  }

  async run(userMessage: string): Promise<void> {
    this.messages.push({ role: 'user', content: userMessage });

    while (true) {
      const response = await this.client.chat(
        this.messages,
        Array.from(this.tools.values()).map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        })) as Tool[],
        { system: SYSTEM_PROMPT, model: this.model }
      );

      // Track token usage
      if (response.usage) {
        this.totalTokens += response.usage.input_tokens + response.usage.output_tokens;
        console.log(`\n[Context: ${this.totalTokens.toLocaleString()} / ${this.contextLength.toLocaleString()} tokens]`);

        // Auto-compression check
        const threshold = Math.floor(this.contextLength * this.compressionThresholdRatio);
        if (this.totalTokens > threshold) {
          await this.compress();
        }
      }

      // 处理响应
      const assistantMsg: MessageParam = { role: 'assistant', content: [] };
      let hasToolCalls = false;

      // First pass: collect tool calls and display text
      const toolCalls: Array<{ block: Anthropic.Messages.ToolUseBlock; tool: ToolDef }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          console.log((block as any).text);
          (assistantMsg.content as any).push(block);
        } else if (block.type === 'tool_use') {
          hasToolCalls = true;
          const toolBlock = block as Anthropic.Messages.ToolUseBlock;
          (assistantMsg.content as any).push(block);

          const tool = this.tools.get(toolBlock.name);
          if (tool) {
            const display = tool.format ? tool.format(toolBlock.input as any) : `${toolBlock.name} ${JSON.stringify(toolBlock.input)}`;
            console.log(display);
            toolCalls.push({ block: toolBlock, tool });
          }
        }
      }

      // Second pass: execute all tools in parallel
      if (toolCalls.length > 0) {
        process.stdout.write(`Running ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}... `);
        const results = await Promise.allSettled(
          toolCalls.map(({ block, tool }) => tool.execute(block.input as any))
        );
        console.log('Done.');

        // Push all results back
        results.forEach((result, i) => {
          const { block } = toolCalls[i];
          const content = result.status === 'fulfilled'
            ? result.value
            : `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
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

      this.messages.push(assistantMsg);

      if (!hasToolCalls) break;
    }
  }
}
