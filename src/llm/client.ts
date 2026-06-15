// LLMClient / LLMStream interfaces and factory.
//
// Every provider adapter implements these interfaces. The rest of the
// codebase programs against these abstractions, never against a concrete SDK.

import type { Model } from "./model.js";
import { AnthropicClient } from "./protocols/anthropic.js";
import { OpenAIChatClient } from "./protocols/openai-chat.js";
import { OpenAIResponsesClient } from "./protocols/openai-responses.js";

// Protocol registry

type LLMClientFactory = (apiKey?: string, baseURL?: string) => LLMClient;

const protocols = new Map<string, LLMClientFactory>();

export function registerProtocol(
  name: string,
  factory: LLMClientFactory,
): void {
  protocols.set(name, factory);
}

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

export interface ChatOptions {
  model?: Model;
  maxTokens?: number;
  system?: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  input: { total: number; cache_miss: number; cache_hit: number };
  output: number;
}

export interface LLMStreamResult {
  content: LLMAssistantBlock[];
  stop_reason: string;
  usage: TokenUsage;
}

// Stream interface

export type LLMStream = AsyncGenerator<
  LLMAssistantBlock,
  LLMStreamResult,
  unknown
>;

// Client interface

export interface LLMClient {
  // Streaming completion — returns immediately, emits events as tokens arrive.
  chatStream(
    blocks: LLMBlock[],
    tools: LLMToolDef[],
    options?: ChatOptions,
  ): LLMStream;
}

// Factory

export function createClient(
  protocol: string,
  apiKey?: string,
  baseURL?: string,
): LLMClient {
  const factory = protocols.get(protocol);
  if (factory) return factory(apiKey, baseURL);
  throw new Error(
    `Unknown LLM protocol: "${protocol}". Registered: ${[...protocols.keys()].join(", ")}`,
  );
}

// Built-in protocol registrations
registerProtocol(
  "anthropic",
  (apiKey, baseURL) => new AnthropicClient(apiKey, baseURL),
);
registerProtocol(
  "openai",
  (apiKey, baseURL) => new OpenAIChatClient(apiKey, baseURL),
);
registerProtocol(
  "openai-responses",
  (apiKey, baseURL) => new OpenAIResponsesClient(apiKey, baseURL),
);
