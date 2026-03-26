import { AnthropicClient } from '../llm/anthropic.js';
import type { MessageParam } from '../llm/anthropic.js';

export interface CompressionService {
  compress(messages: MessageParam[], client: AnthropicClient, model: string | undefined): Promise<MessageParam[]>;
}

export class CompressionServiceImpl implements CompressionService {
  private readonly recentCount = 10;

  async compress(messages: MessageParam[], client: AnthropicClient, model: string | undefined): Promise<MessageParam[]> {
    if (messages.length <= this.recentCount + 2) {
      return messages; // Not enough to compress
    }

    const messagesToSummarize = messages.slice(0, -this.recentCount);
    const summaryPrompt = `Summarize the following conversation concisely. Focus on:
- What was being worked on
- Key decisions made
- Current state

Keep it brief and actionable.

Conversation:
${JSON.stringify(messagesToSummarize, null, 2)}`;

    try {
      const summary = await client.chat(
        [{ role: 'user', content: summaryPrompt }],
        [],
        { model, maxTokens: 1000 }
      );

      const summaryText = (summary.content[0] as any)?.text || 'Conversation summary unavailable';
      return [
        { role: 'user', content: `[Previous conversation summary]\n${summaryText}` },
        ...messages.slice(-this.recentCount)
      ];
    } catch (e) {
      throw new Error(`Compression failed: ${(e as Error).message}`);
    }
  }
}
