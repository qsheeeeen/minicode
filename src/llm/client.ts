/**
 * LLMClient / LLMStream interfaces and factory.
 *
 * Every provider adapter implements these interfaces. The rest of the
 * codebase programs against these abstractions, never against a concrete SDK.
 */

import type {
  MessageParam,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  ContentBlock,
} from "./types.js";

import { AnthropicClient } from "./anthropic.js";
import { OpenAIChatClient } from "./openai-chat.js";
import { OpenAIResponsesClient } from "./openai-responses.js";

// Stream interface

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "contentBlock"; block: ContentBlock };

/** Provider-agnostic stream that yields canonical content events. */
export interface LLMStream extends AsyncIterable<StreamEvent> {

  /** Resolves with the full response once the stream finishes. */
  finalMessage(): Promise<LLMResponse>;

  /** Abort the in-flight request. */
  abort(): void;
}

export class GenericStream implements LLMStream {
  constructor(
    private generator: AsyncGenerator<StreamEvent, LLMResponse, unknown>,
    private abortFn: () => void
  ) {}

  [Symbol.asyncIterator]() {
    return this.generator;
  }

  async finalMessage(): Promise<LLMResponse> {
    let result: IteratorResult<StreamEvent, LLMResponse>;
    do {
      result = await this.generator.next();
    } while (!result.done);
    return result.value;
  }

  abort(): void {
    this.abortFn();
  }
}

// Client interface

export interface LLMClient {


  /** Streaming completion — returns immediately, emits events as tokens arrive. */
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
