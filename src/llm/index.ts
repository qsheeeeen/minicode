/**
 * Barrel exports for the LLM layer.
 *
 * Consumers should import from here or from `./types.js` / `./client.js`.
 * Never import provider SDKs directly outside of `src/llm/`.
 */

// Canonical types
export type {
  EffortLevel,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  UserContentBlock,
  MessageParam,
  LLMToolDef,
  ChatOptions,
  TokenUsage,
  LLMResponse,
} from "./types.js";

// Client interface + factory
export type { LLMClient, LLMStream } from "./client.js";
export { createClient } from "./client.js";

// Concrete adapters (for direct instantiation)
export { AnthropicClient } from "./anthropic.js";
