import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';

export type { Anthropic };

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  thinking?: boolean;
  thinkingTokens?: number;
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
        type: 'enabled',
        budget_tokens: options.thinkingTokens || 20000
      };
    }

    return await this.client.messages.create(params);
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
        type: 'enabled',
        budget_tokens: options.thinkingTokens || 20000
      };
    }

    return this.client.messages.stream(params) as unknown as MessageStream<null>;
  }
}
