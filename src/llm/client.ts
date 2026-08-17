// LLMClient / LLMStream interfaces and factory.
//
// Every provider adapter implements these interfaces. The rest of the
// codebase programs against these abstractions, never against a concrete SDK.

import type { Model } from "./model.js";
import type { TurnFault } from "../core/results.js";

// Protocol registry

type LLMClientFactory = (apiKey?: string, baseURL?: string) => LLMClient;

const protocols = new Map<string, LLMClientFactory>();

export function registerProtocol(
  name: string,
  factory: LLMClientFactory,
): void {
  protocols.set(name, factory);
}

/** Remove all registered protocols (registration site rebuilds builtins). */
export function clearProtocols(): void {
  protocols.clear();
}

import type { LLMAssistantBlock, LLMBlock } from "../core/blocks.js";

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
  model?: Model;
  maxTokens?: number;
  system?: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  input: { total: number; cache_miss: number; cache_hit: number };
  output: number;
}

/** Canonical stop reasons. Vendor-specific values are mapped, never passed
 *  through — unmapped statuses become "unknown". */
export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "unknown";

/** Stream terminal value. Provider failures arrive as a value (`ok: false`),
 *  never as a raw vendor exception; the caller converts the fault into a
 *  TurnFaultError at the turn boundary. Abort still propagates as AbortError. */
export interface LLMStreamOk {
  ok: true;
  content: LLMAssistantBlock[];
  stop_reason: StopReason;
  usage: TokenUsage;
}

export type LLMStreamResult = LLMStreamOk | { ok: false; fault: TurnFault };

// Stream interface

export type LLMStream = AsyncGenerator<
  LLMAssistantBlock,
  LLMStreamResult,
  unknown
>;

// Client interface

export interface LLMClient {
  // Streaming completion — returns immediately, emits events as tokens arrive.
  // Blocks are a read view of the conversation; adapters must not mutate.
  chatStream(
    blocks: readonly LLMBlock[],
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
