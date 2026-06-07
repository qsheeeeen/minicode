/**
 * Anthropic adapter — wraps the `@anthropic-ai/sdk` and implements the
 * canonical `LLMClient` / `LLMStream` interfaces.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream.js";
import type {
  MessageCreateParamsBase,
  MessageCreateParamsNonStreaming,
  OutputConfig,
} from "@anthropic-ai/sdk/resources/messages.js";

import type { LLMClient, LLMStream } from "./client.js";
import type {
  MessageParam,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  ContentBlock,
  EffortLevel,
} from "./types.js";

// Re-export EffortLevel for backward compat in config.ts etc.
export type { EffortLevel };

function mapEffort(effort: EffortLevel): any {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    case "max":
      return "max";
  }
}

// Anthropic-native types (used only inside this adapter)

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicContentBlock = Anthropic.Messages.ContentBlock;

// Conversion helpers

/**
 * Convert canonical messages to Anthropic SDK format.
 * Since our canonical format is modeled after Anthropic's, the conversion
 * is mostly a pass-through.
 */
function toAnthropicMessages(messages: MessageParam[]): AnthropicMessageParam[] {
  return messages as unknown as AnthropicMessageParam[];
}

function toAnthropicTools(tools: LLMToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as AnthropicTool["input_schema"],
  }));
}

function toCanonicalResponse(msg: Anthropic.Messages.Message): LLMResponse {
  return {
    content: msg.content as unknown as ContentBlock[],
    stop_reason: msg.stop_reason ?? "end_turn",
    usage: {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens:
        (msg.usage as any).cache_creation_input_tokens ?? 0,
      cache_read_input_tokens:
        (msg.usage as any).cache_read_input_tokens ?? 0,
    },
  };
}

// Stream wrapper

class AnthropicStream implements LLMStream {
  constructor(private stream: MessageStream<null>) {}

  on(event: string, listener: (...args: any[]) => void): void {
    if (event === "contentBlock") {
      this.stream.on("contentBlock", listener as any);
    } else {
      this.stream.on(event as any, listener as any);
    }
  }

  async finalMessage(): Promise<LLMResponse> {
    const msg = await this.stream.finalMessage();
    return toCanonicalResponse(msg);
  }

  abort(): void {
    this.stream.abort();
  }
}

// Client

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      authToken: apiKey ?? null,
      baseURL,
    });
  }

  chatStream(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const params: MessageCreateParamsBase = {
      model: options.model || "claude-sonnet-4-5",
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages: toAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      thinking: { type: "adaptive" },
    };

    if (options.effort) {
      params.output_config = {
        effort: mapEffort(options.effort),
      };
    }

    const stream = this.client.messages.stream(params, {
      signal: options.signal,
    }) as unknown as MessageStream<null>;

    return new AnthropicStream(stream);
  }
}
