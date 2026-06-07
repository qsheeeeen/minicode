/**
 * Provider-agnostic LLM types.
 *
 * Every adapter (Anthropic, OpenAI Chat, OpenAI Responses) converts between
 * its SDK types and these canonical types. The rest of the codebase only
 * depends on this file.
 */

// ---------------------------------------------------------------------------
// Effort
// ---------------------------------------------------------------------------

/** Superset of effort levels across providers.
 *  Anthropic: none | minimal | low | medium | high | xhigh | max
 *  OpenAI:    none | minimal | low | medium | high | xhigh
 */
export type EffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

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

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

/** Blocks that can appear in a user turn (including tool results). */
export type UserContentBlock = ToolResultBlock;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[] | UserContentBlock[];
}

// ---------------------------------------------------------------------------
// Tool definitions (passed to the LLM)
// ---------------------------------------------------------------------------

export interface LLMToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Chat options
// ---------------------------------------------------------------------------

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  effort?: EffortLevel;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: string;
  usage: TokenUsage;
}
