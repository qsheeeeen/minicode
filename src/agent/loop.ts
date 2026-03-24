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
  execute: (args: any) => Promise<string>;
};

export class Agent {
  private client: AnthropicClient;
  private tools: Map<string, ToolDef>;
  private messages: MessageParam[] = [];

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new AnthropicClient(apiKey, baseURL);
    this.tools = new Map<string, ToolDef>([
      ['read', readTool as ToolDef],
      ['write', writeTool as ToolDef],
      ['edit', editTool as ToolDef],
      ['bash', bashTool as ToolDef]
    ]);
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
        { system: SYSTEM_PROMPT }
      );

      // 处理响应
      const assistantMsg: MessageParam = { role: 'assistant', content: [] };
      let hasToolCalls = false;

      for (const block of response.content) {
        if (block.type === 'text') {
          console.log((block as any).text);
          (assistantMsg.content as any).push(block);
        } else if (block.type === 'tool_use') {
          hasToolCalls = true;
          const toolBlock = block as Anthropic.Messages.ToolUseBlock;
          (assistantMsg.content as any).push(block);

          // 执行工具
          const tool = this.tools.get(toolBlock.name);
          if (tool) {
            try {
              const result = await tool.execute(toolBlock.input as any);
              this.messages.push({
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolBlock.id,
                  content: result
                }]
              });
            } catch (e) {
              this.messages.push({
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolBlock.id,
                  content: `Error: ${(e as Error).message}`
                }]
              });
            }
          }
        }
      }

      this.messages.push(assistantMsg);

      if (!hasToolCalls) break;
    }
  }
}
