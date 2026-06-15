// ContextManager owns compression logic, token tracking, and the reactive
// token count signal.
//
// The compress() method receives cross-manager deps as params (context, model,
// changeJournal, activeUserMessageOrdinal, statusReporter) to avoid coupling to other managers.
// It returns the new activeUserMessageOrdinal so the caller (Agent) can update
// SessionManager.

import type { LLMClient, TokenUsage } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { SessionStats } from "./session-stats.js";
import { Signal } from "../utils/signal.js";
import { TokenTracker } from "./token-tracker.js";
import {
  SummaryCompressionStrategy,
  type CompressionStrategy,
} from "./compression-service.js";
import { ChangeJournal } from "./change-journal.js";
import type { LLMContext } from "../llm/context.js";
import type { StatusReporter } from "./session-manager.js";

export interface ContextManagerOpts {
  readonly contextLength: number;
  readonly compressionThresholdRatio: number;
  readonly tokenCount$: Signal<number>;
  readonly contextManager: LLMContext;
  readonly statusReporter: StatusReporter;
  readonly sessionStats?: SessionStats;
  readonly compressionStrategy?: CompressionStrategy;
  readonly thresholdPolicy?: import("./token-tracker.js").ThresholdPolicy;
}

export interface CompressDeps {
  context: LLMContext;
  client: LLMClient;
  model: Model;
  changeJournal: ChangeJournal;
  activeUserMessageOrdinal: number;
  statusReporter: StatusReporter;
}

export class ContextManager {
  private tokenTracker: TokenTracker;
  private compressionService: CompressionStrategy;
  private isCompressing = false;
  readonly tokenCount$: Signal<number>;
  private statusReporter: StatusReporter;

  constructor(opts: ContextManagerOpts) {
    this.tokenCount$ = opts.tokenCount$;
    this.statusReporter = opts.statusReporter;
    this.compressionService =
      opts.compressionStrategy ?? new SummaryCompressionStrategy();
    this.tokenTracker = new TokenTracker(
      opts.contextLength,
      opts.compressionThresholdRatio,
      opts.tokenCount$,
      opts.statusReporter,
      opts.sessionStats,
      opts.thresholdPolicy,
    );
  }

  /** Process token usage from an LLM response. Returns whether compression is needed. */
  processTokenUsage(model: string, usage: TokenUsage): boolean {
    if (!usage) return false;
    const { shouldCompress } = this.tokenTracker.processUsage(model, usage);
    return shouldCompress;
  }

  /**
   * Compress conversation context when context window threshold is exceeded.
   * Receives cross-manager deps as params. Returns the new activeUserMessageOrdinal.
   */
  async compress(deps: CompressDeps): Promise<number> {
    if (this.isCompressing) return deps.activeUserMessageOrdinal;
    this.isCompressing = true;

    try {
      const recentCount = 10;
      const userMessageCount = deps.context.getUserMessageCount();
      if (userMessageCount <= recentCount + 2) {
        deps.statusReporter({
          role: "status",
          content: "Not enough conversation to compress.",
          timestamp: new Date(),
        });
        return deps.activeUserMessageOrdinal;
      }

      const totalTokens = this.tokenTracker.getTotal();
      deps.statusReporter({
        role: "status",
        content: `Compressing ${userMessageCount - recentCount} user messages (${totalTokens} tokens)...`,
        timestamp: new Date(),
      });

      const originalUserPrompts = userMessageCount;

      const compressed = await this.compressionService.compress(
        deps.context,
        deps.client,
        deps.model,
      );

      const originalKept = recentCount + 1; // compression adds 1 summary user message
      const prunedCount = originalUserPrompts - originalKept;

      if (prunedCount > 0) {
        await deps.changeJournal.pruneAndRenumberUserMessages(prunedCount, 1);
      }

      deps.context.replaceBlocks(compressed);
      this.tokenTracker.reset();

      // Recalculate activeUserMessageOrdinal
      const newActiveIdx = deps.context.getUserMessageCount();

      deps.statusReporter({
        role: "status",
        content: `Compressed: ${prunedCount} user messages removed, ${newActiveIdx} remaining.`,
        timestamp: new Date(),
      });

      return newActiveIdx;
    } catch (error) {
      deps.statusReporter({
        role: "error",
        content: `Compression failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
      return deps.activeUserMessageOrdinal;
    } finally {
      this.isCompressing = false;
    }
  }

  getTokenCount(): number {
    return this.tokenTracker.getTotal();
  }

  setTokenCount(count: number): void {
    this.tokenTracker.setCount(count);
  }

  reset(): void {
    this.tokenTracker.reset();
  }

  setContextLength(length: number): void {
    this.tokenTracker.setContextLength(length);
  }

  getIsCompressing(): boolean {
    return this.isCompressing;
  }
}
