// LLMClient / LLMStream interfaces and factory.
//
// Every provider adapter implements these interfaces. The rest of the
// codebase programs against these abstractions, never against a concrete SDK.

import type { MessageParam, ContentBlock, ToolUseBlock } from "../messages.js";

import { AnthropicClient } from "./anthropic.js";
import { OpenAIChatClient } from "./openai-chat.js";
import { OpenAIResponsesClient } from "./openai-responses.js";

// Protocol registry

type LLMClientFactory = (apiKey?: string, baseURL?: string) => LLMClient;

const protocols = new Map<string, LLMClientFactory>();

function registerProtocol(
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

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  effort?: EffortLevel;
  signal?: AbortSignal;
}

export interface TokenUsage {
  input: { total: number; cache_miss: number; cache_hit: number };
  output: number;
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
  | { type: "tool_use"; block: ToolUseBlock };

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
registerProtocol("anthropic", (apiKey, baseURL) => new AnthropicClient(apiKey, baseURL));
registerProtocol("openai", (apiKey, baseURL) => new OpenAIChatClient(apiKey, baseURL));
registerProtocol("openai-responses", (apiKey, baseURL) => new OpenAIResponsesClient(apiKey, baseURL));
