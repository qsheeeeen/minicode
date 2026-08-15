// Built-in protocol registration — the only place that knows the shipped
// adapter set. Importing this module registers them (the composition root
// and tests do); client.ts itself stays free of adapter knowledge.

import { clearProtocols, registerProtocol } from "../client.js";
import { AnthropicClient } from "./anthropic.js";
import { OpenAIChatClient } from "./openai-chat.js";
import { OpenAIResponsesClient } from "./openai-responses.js";

export function registerBuiltinProtocols(): void {
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
}

registerBuiltinProtocols();

/** Reset to the built-in protocol set (test isolation). */
export function resetProtocols(): void {
  clearProtocols();
  registerBuiltinProtocols();
}
