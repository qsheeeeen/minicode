import Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream.js";
import type {
  MessageCreateParamsBase,
  MessageCreateParamsNonStreaming,
  OutputConfig,
} from "@anthropic-ai/sdk/resources/messages.js";

export type { Anthropic };
export type EffortLevel = NonNullable<OutputConfig["effort"]>;

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  effort?: EffortLevel;
  signal?: AbortSignal;
}

export type MessageParam = Anthropic.Messages.MessageParam;
export type Tool = Anthropic.Messages.Tool;
export type Message = Anthropic.Messages.Message;
export type ContentBlock = Anthropic.Messages.ContentBlock;
export class AnthropicClient {
  private client: Anthropic;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      authToken: apiKey ?? null,
      baseURL,
    });
  }

  async chat(
    messages: MessageParam[],
    tools: Tool[],
    options: ChatOptions = {},
  ): Promise<Message> {
    const params: MessageCreateParamsNonStreaming = {
      model: options.model || "claude-sonnet-4-5",
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages,
      tools,
      thinking: { type: "adaptive" },
    };

    if (options.effort) {
      params.output_config = {
        effort: options.effort,
      };
    }

    return await this.client.messages.create(params, {
      signal: options.signal,
    });
  }

  chatStream(
    messages: MessageParam[],
    tools: Tool[],
    options: ChatOptions = {},
  ): MessageStream<null> {
    const params: MessageCreateParamsBase = {
      model: options.model || "claude-sonnet-4-5",
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages,
      tools,
      thinking: { type: "adaptive" },
    };

    if (options.effort) {
      params.output_config = {
        effort: options.effort,
      };
    }

    return this.client.messages.stream(params, {
      signal: options.signal,
    }) as unknown as MessageStream<null>;
  }
}
