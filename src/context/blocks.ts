export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export type ProcessBlock = ThinkingBlock | ToolCallBlock;
