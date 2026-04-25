import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';

export type { Anthropic };

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  thinking?: boolean;
  effort?: string;
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
      baseURL
    });
  }

  async chat(
    messages: MessageParam[],
    tools: Tool[],
    options: ChatOptions = {}
  ): Promise<Message> {
    const params: any = {
      model: options.model || 'claude-sonnet-4-5',
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages,
      tools
    };

    if (options.thinking) {
      params.thinking = {
        type: 'enabled'
      };
    }

    if (options.effort) {
      params.output_config = {
        effort: options.effort
      };
    }

    return await this.client.messages.create(params, {
      signal: options.signal
    });
  }

  chatStream(
    messages: MessageParam[],
    tools: Tool[],
    options: ChatOptions = {}
  ): MessageStream<null> {
    const params: any = {
      model: options.model || 'claude-sonnet-4-5',
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages,
      tools
    };

    if (options.thinking) {
      params.thinking = {
        type: 'enabled'
      };
    }

    if (options.effort) {
      params.output_config = {
        effort: options.effort
      };
    }

    return this.client.messages.stream(params, {
      signal: options.signal
    }) as unknown as MessageStream<null>;
  }
}
