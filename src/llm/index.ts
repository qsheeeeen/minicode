// Barrel exports for the LLM layer.
//
// Consumers should import from here or from `./client.js`.
// Never import provider SDKs directly outside of `src/llm/`.

// Message types (owned by messages.ts)
export type {
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  UserContentBlock,
  MessageParam,
} from "../messages.js";

// LLM interface types + factory
export type {
  EffortLevel,
  LLMToolDef,
  ChatOptions,
  TokenUsage,
  LLMResponse,
  LLMClient,
  LLMStream,
} from "./client.js";
export { createClient } from "./client.js";

// Concrete adapters (for direct instantiation)
export { AnthropicClient } from "./anthropic.js";
