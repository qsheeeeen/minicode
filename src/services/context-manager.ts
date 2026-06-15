// ContextManager owns compression logic and context-window token tracking.
//
// The compress() method receives cross-manager deps as params (context, model,
// changeJournal, activeUserMessageOrdinal, statusReporter) to avoid coupling to other managers.
// It returns the new activeUserMessageOrdinal so the caller (Agent) can update
// SessionManager.

import type { LLMClient, TokenUsage } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { SessionStats } from "./session-stats.js";
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
  readonly statusReporter: StatusReporter;
  readonly sessionStats?: SessionStats;
  readonly compressionStrategy?: CompressionStrategy;
  readonly thresholdPolicy?: ThresholdPolicy;
}

export interface ThresholdPolicy {
  readonly thresholds: readonly number[];
  shouldCompress(total: number, contextLength: number, ratio: number): boolean;
}

export interface TokenUsageResult {
  totalTokens: number;
  percentage: number;
  shouldCompress: boolean;
}

export class DefaultThresholdPolicy implements ThresholdPolicy {
  readonly thresholds = [25, 50, 75, 90] as const;

  shouldCompress(
    total: number,
    contextLength: number,
    ratio: number,
  ): boolean {
    const threshold = Math.floor(contextLength * ratio);
    return total > threshold;
  }
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
  private compressionService: CompressionStrategy;
  private isCompressing = false;
  private statusReporter: StatusReporter;
  private contextLength: number;
  private compressionThresholdRatio: number;
  private sessionStats?: SessionStats;
  private thresholdPolicy: ThresholdPolicy;
  private tokenCount = 0;
  private lastShownThreshold = 0;

  constructor(opts: ContextManagerOpts) {
    this.contextLength = opts.contextLength;
    this.compressionThresholdRatio = opts.compressionThresholdRatio;
    this.statusReporter = opts.statusReporter;
    this.sessionStats = opts.sessionStats;
    this.thresholdPolicy = opts.thresholdPolicy ?? new DefaultThresholdPolicy();
    this.compressionService =
      opts.compressionStrategy ?? new SummaryCompressionStrategy();
  }

  /** Process token usage from an LLM result. Returns current count and compression decision. */
  processTokenUsage(model: string, usage: TokenUsage): TokenUsageResult {
    const totalTokens = usage.input.total + usage.output;
    this.sessionStats?.recordUsage(model, usage);
    this.tokenCount = totalTokens;

    const ratio = totalTokens / this.contextLength;
    const percentage = Math.floor(ratio * 100);

    for (const threshold of this.thresholdPolicy.thresholds) {
      if (percentage >= threshold && this.lastShownThreshold < threshold) {
        this.statusReporter({
          role: "status",
          content: `[${percentage}% context]`,
          timestamp: new Date(),
        });
        this.lastShownThreshold = threshold;
        break;
      }
    }

    const shouldCompress = this.thresholdPolicy.shouldCompress(
      totalTokens,
      this.contextLength,
      this.compressionThresholdRatio,
    );

    return { totalTokens, percentage, shouldCompress };
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

      const totalTokens = this.tokenCount;
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
      this.reset();

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
    return this.tokenCount;
  }

  setTokenCount(count: number): void {
    this.tokenCount = count;
    this.lastShownThreshold = 0;
  }

  reset(): void {
    this.tokenCount = 0;
    this.lastShownThreshold = 0;
  }

  setContextLength(length: number): void {
    this.contextLength = length;
  }

  getIsCompressing(): boolean {
    return this.isCompressing;
  }
}
