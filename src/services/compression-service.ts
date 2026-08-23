import { randomUUID } from "crypto";
import { TurnFaultError, isTurnFaultError } from "../core/results.js";
import type { LLMClient, LLMStreamOk } from "../llm/client.js";
import type { LLMContext } from "../core/context.js";
import type { LLMBlock } from "../core/blocks.js";
import type { Model } from "../llm/model.js";

/** Compression outcome metadata — the strategy reports what it kept, so the
 *  caller never re-derives counts from a private implementation invariant. */
export interface CompressionOutcome {
  blocks: LLMBlock[];
  /** How many of the original user messages survive in `blocks`. */
  keptUserMessages: number;
  /** Stable ids of the user messages folded into the summary — the caller
   *  prunes exactly these from the change journal. */
  droppedMessageIds: string[];
}

export interface CompressionStrategy {
  compress(
    context: LLMContext,
    client: LLMClient,
    model: Model | undefined,
  ): Promise<CompressionOutcome>;
}

export class SummaryCompressionStrategy implements CompressionStrategy {
  private readonly recentCount = 10;

  async compress(
    context: LLMContext,
    client: LLMClient,
    model: Model | undefined,
  ): Promise<CompressionOutcome> {
    if (context.getUserMessageCount() <= this.recentCount + 2) {
      return {
        blocks: context.getBlocks(),
        keptUserMessages: context.getUserMessageCount(),
        droppedMessageIds: [],
      };
    }

    const { prefix, suffix } = context.splitAtRecentUserMessages(
      this.recentCount,
    );
    const droppedMessageIds = prefix
      .filter((b) => b.type === "user")
      .map((b) => (b as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
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

      let result: LLMStreamOk | undefined;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          const terminal = next.value;
          // The fault stays typed: the turn boundary sees a TurnFaultError,
          // and the status line keeps kind/retryable information.
          if (!terminal.ok) throw new TurnFaultError(terminal.fault);
          result = terminal;
          break;
        }
      }

      const summaryText = this.extractSummaryText(result);
      // [summary user message, ...the recent suffix]
      return {
        blocks: [
          {
            type: "user",
            id: randomUUID(),
            text: `[Previous conversation summary]\n${summaryText}`,
          },
          ...suffix,
        ],
        keptUserMessages: this.recentCount + 1,
        droppedMessageIds,
      };
    } catch (e) {
      if (isTurnFaultError(e)) throw e;
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

  private extractSummaryText(summary: LLMStreamOk): string {
    for (const block of summary.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
    return "Conversation summary unavailable";
  }
}
