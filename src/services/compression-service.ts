import type { LLMClient, LLMResponse } from "../llm/client.js";
import type { LLMBlock } from "../llm/history.js";
import { splitHistoryTurns } from "../llm/history.js";
import type { Model } from "../llm/model.js";

export interface CompressionStrategy {
  compress(
    blocks: LLMBlock[],
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMBlock[]>;
}

export class SummaryCompressionStrategy implements CompressionStrategy {
  private readonly recentCount = 10;

  async compress(
    blocks: LLMBlock[],
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMBlock[]> {
    const turns = splitHistoryTurns(blocks);
    if (turns.length <= this.recentCount + 2) {
      return blocks;
    }

    const turnsToSummarize = turns.slice(0, -this.recentCount);
    const conversationText = this.extractConversationText(turnsToSummarize);

    const summaryPrompt = `Summarize the following conversation concisely. Focus on:
- What was being worked on
- Key decisions made
- Current state

Keep it brief and actionable.

Conversation:
${conversationText}`;

    try {
      const stream = client.chatStream(
        [{ role: "user", content: summaryPrompt }],
        [],
        { model, maxTokens: 1000 },
      );

      let response: LLMResponse | undefined;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          response = next.value as LLMResponse;
          break;
        }
      }

      const summaryText = this.extractSummaryText(response!);
      return [
        {
          type: "user",
          text: `[Previous conversation summary]\n${summaryText}`,
        },
        ...turns.slice(-this.recentCount).flat(),
      ];
    } catch (e) {
      throw new Error(`Compression failed: ${(e as Error).message}`);
    }
  }

  private extractConversationText(turns: LLMBlock[][]): string {
    const lines: string[] = [];
    for (const turn of turns) {
      for (const block of turn) {
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
    }
    return lines.join("\n");
  }

  private extractSummaryText(summary: LLMResponse): string {
    for (const block of summary.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
    return "Conversation summary unavailable";
  }
}

/** @deprecated Use SummaryCompressionStrategy instead. */
export const CompressionService = SummaryCompressionStrategy;
