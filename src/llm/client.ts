// LLMClient / LLMStream interfaces and factory.
//
// Every provider adapter implements these interfaces. The rest of the
// codebase programs against these abstractions, never against a concrete SDK.

import type { MessageParam, ContentBlock } from "../messages.js";

import { AnthropicClient } from "./anthropic.js";
import { OpenAIChatClient } from "./openai-chat.js";
import { OpenAIResponsesClient } from "./openai-responses.js";

// LLM interface types (owned by the client layer)

export type EffortLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface LLMToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  effort?: EffortLevel;
  signal?: AbortSignal;
}

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

// Stream interface

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "contentBlock"; block: ContentBlock };

export type LLMStream = AsyncGenerator<StreamEvent, LLMResponse, unknown>;

// Client interface

export interface LLMClient {
  // Streaming completion — returns immediately, emits events as tokens arrive.
  chatStream(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options?: ChatOptions,
  ): LLMStream;
}

// Factory

export function createClient(
  provider: string,
  apiKey?: string,
  baseURL?: string,
): LLMClient {
  switch (provider) {
    case "anthropic":
    case "zhipu":
      return new AnthropicClient(apiKey, baseURL);
    case "openai":
      return new OpenAIChatClient(apiKey, baseURL);
    case "openai-responses":
      return new OpenAIResponsesClient(apiKey, baseURL);
    default:
      // Default: treat as Anthropic-compatible
      return new AnthropicClient(apiKey, baseURL);
  }
}
