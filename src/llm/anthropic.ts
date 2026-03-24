import Anthropic from '@anthropic-ai/sdk';

export type { Anthropic };

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
}

export type MessageParam = Anthropic.Messages.MessageParam;
export type Tool = Anthropic.Messages.Tool;
export type Message = Anthropic.Messages.Message;

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
    return await this.client.messages.create({
      model: options.model || 'claude-sonnet-4-5',
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages,
      tools
    });
  }
}
