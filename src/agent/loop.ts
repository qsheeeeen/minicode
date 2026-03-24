import { AnthropicClient, MessageParam, Tool, Anthropic } from '../llm/anthropic.js';
import { readTool, writeTool, editTool, bashTool } from '../tools/index.js';

const SYSTEM_PROMPT = `You are an expert coding assistant.

Available tools:
- read: Read file contents
- write: Create or overwrite files
- edit: Make surgical edits to files (old text must match exactly)
- bash: Execute bash commands

Guidelines:
- Use bash for file operations (ls, grep, find)
- Use read to examine files before editing
- Be concise`;

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
