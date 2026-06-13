export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock;
export type ContextBlock = AssistantBlock | ToolResultBlock;

// Compatibility aliases for provider-facing code.
export type ContentBlock = AssistantBlock;
export type UserContentBlock = ToolResultBlock;
