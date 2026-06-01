import type {
  AnthropicClient,
  MessageParam,
  Message,
  Anthropic,
} from "#src/llm/anthropic.js";

export class CompressionService {
  private readonly recentCount = 10;

  async compress(
    messages: MessageParam[],
    client: AnthropicClient,
    model: string | undefined,
  ): Promise<MessageParam[]> {
    if (messages.length <= this.recentCount + 2) {
      return messages; // Not enough to compress
    }

    const messagesToSummarize = messages.slice(0, -this.recentCount);
    const conversationText = this.extractConversationText(messagesToSummarize);

    const summaryPrompt = `Summarize the following conversation concisely. Focus on:
- What was being worked on
- Key decisions made
- Current state

Keep it brief and actionable.

Conversation:
${conversationText}`;

    try {
      const summary = await client.chat(
        [{ role: "user", content: summaryPrompt }],
        [],
        { model, maxTokens: 1000 },
      );

      const summaryText = this.extractSummaryText(summary);
      return [
        {
          role: "user",
          content: `[Previous conversation summary]\n${summaryText}`,
        },
        ...messages.slice(-this.recentCount),
      ];
    } catch (e) {
      throw new Error(`Compression failed: ${(e as Error).message}`);
    }
  }

  private extractConversationText(messages: MessageParam[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      const content = msg.content;
      if (typeof content === "string") {
        lines.push(`${role}: ${content}`);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            lines.push(`${role}: ${b.text}`);
          } else if (b.type === "tool_use") {
            lines.push(`${role}: [Called tool: ${b.name}]`);
          } else if (b.type === "tool_result") {
            const resultContent = b.content;
            if (typeof resultContent === "string") {
              lines.push(`Tool result: ${resultContent.slice(0, 500)}`);
            }
          }
        }
      }
    }
    return lines.join("\n");
  }

  private extractSummaryText(summary: Message): string {
    for (const block of summary.content) {
      if (block.type === "text") {
        return (block as Anthropic.TextBlock).text;
      }
    }
    return "Conversation summary unavailable";
  }
}
