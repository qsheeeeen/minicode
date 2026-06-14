import type { LLMClient } from "../llm/client.js";
import type { LLMResponse } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { LLMTurn } from "../llm/history.js";

export interface CompressionStrategy {
  compress(
    turns: LLMTurn[],
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMTurn[]>;
}

export class SummaryCompressionStrategy implements CompressionStrategy {
  private readonly recentCount = 10;

  async compress(
    turns: LLMTurn[],
    client: LLMClient,
    model: Model | undefined,
  ): Promise<LLMTurn[]> {
    if (turns.length <= this.recentCount + 2) {
      return turns; // Not enough to compress
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
          userText: `[Previous conversation summary]\n${summaryText}`,
          process: [],
        },
        ...turns.slice(-this.recentCount),
      ];
    } catch (e) {
      throw new Error(`Compression failed: ${(e as Error).message}`);
    }
  }

  private extractConversationText(turns: LLMTurn[]): string {
    const lines: string[] = [];
    for (const turn of turns) {
      lines.push(`User: ${turn.userText}`);
      for (const block of turn.process) {
        if (block.type === "thinking") {
          lines.push(`Assistant thinking: ${block.thinking}`);
        } else {
          lines.push(`Assistant: [Called tool: ${block.name}]`);
          if (block.result !== undefined) {
            lines.push(`Tool result: ${block.result.slice(0, 500)}`);
          }
        }
      }
      if (turn.assistantText) lines.push(`Assistant: ${turn.assistantText}`);
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
