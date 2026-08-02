import type { LLMClient, LLMStreamResult } from "../llm/client.js";
import type { LLMBlock, LLMContext } from "../llm/context.js";
import type { Model } from "../llm/model.js";

export interface CompressionStrategy {
  compress(
    context: LLMContext,
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMBlock[]>;
}

export class SummaryCompressionStrategy implements CompressionStrategy {
  private readonly recentCount = 10;

  async compress(
    context: LLMContext,
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMBlock[]> {
    if (context.getUserMessageCount() <= this.recentCount + 2) {
      return context.getBlocks();
    }

    const { prefix, suffix } = context.splitAtRecentUserMessages(
      this.recentCount,
    );
    const conversationText = this.extractConversationText(prefix);

    const summaryPrompt = `Summarize the following conversation concisely. Focus on:
- What was being worked on
- Key decisions made
- Current state

Keep it brief and actionable.

Conversation:
${conversationText}`;

    try {
      const stream = client.chatStream(
        [{ type: "user", text: summaryPrompt }],
        [],
        { model, maxTokens: 1000 },
      );

      let result: LLMStreamResult | undefined;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          result = next.value as LLMStreamResult;
          break;
        }
      }

      const summaryText = this.extractSummaryText(result!);
      return [
        {
          type: "user",
          text: `[Previous conversation summary]\n${summaryText}`,
        },
        ...suffix,
      ];
    } catch (e) {
      throw new Error(`Compression failed: ${(e as Error).message}`);
    }
  }

  private extractConversationText(blocks: LLMBlock[]): string {
    const lines: string[] = [];
    for (const block of blocks) {
      if (block.type === "user") {
        lines.push(`User: ${block.text}`);
      } else if (block.type === "thinking") {
        lines.push(`Assistant thinking: ${block.thinking}`);
      } else if (block.type === "tool_use") {
        lines.push(`Assistant: [Called tool: ${block.name}]`);
      } else if (block.type === "tool_result") {
        lines.push(`Tool result: ${block.content.slice(0, 500)}`);
      } else if (block.type === "text") {
        lines.push(`Assistant: ${block.text}`);
      }
    }
    return lines.join("\n");
  }

  private extractSummaryText(summary: LLMStreamResult): string {
    for (const block of summary.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
    return "Conversation summary unavailable";
  }
}
