// Conversation block types — the core asset's data model. The LLM port
// (llm/client.ts) and every derived view speak this vocabulary; it must not
// depend on any vendor boundary.

export interface LLMUserBlock {
  type: "user";
  text: string;
  /** Stable identity for this user message — assigned when the message is
   *  created and never reused. Journal entries and session-tree entries key
   *  on it; protocol serializers ignore it. */
  id?: string;
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

/** Media types both the Anthropic and OpenAI image parts accept. */
export type LLMMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

/** An image attached to a block — decoded base64, vendor-neutral. */
export interface LLMImage {
  mediaType: LLMMediaType;
  base64: string;
}

export interface LLMToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  /** Images shown to vision-capable models alongside `content`. */
  images?: LLMImage[];
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
