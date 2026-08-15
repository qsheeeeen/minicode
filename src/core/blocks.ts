// Conversation block types — the core asset's data model. The LLM port
// (llm/client.ts) and every derived view speak this vocabulary; it must not
// depend on any vendor boundary.

export interface LLMUserBlock {
  type: "user";
  text: string;
}

export interface LLMTextBlock {
  type: "text";
  text: string;
}

export interface LLMThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface LLMToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LLMAssistantBlock =
  | LLMTextBlock
  | LLMThinkingBlock
  | LLMToolUseBlock;

export type LLMBlock =
  | LLMUserBlock
  | LLMTextBlock
  | LLMThinkingBlock
  | LLMToolUseBlock
  | LLMToolResultBlock;
