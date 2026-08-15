// ContextManager owns context-window token tracking and compression.

import type { LLMClient, TokenUsage } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { SessionStats } from "./session-stats.js";
import {
  SummaryCompressionStrategy,
  type CompressionStrategy,
} from "./compression-service.js";
import { ChangeJournal } from "./change-journal.js";
import type { LLMContext } from "../llm/context.js";
import type { RuntimeEvents, RuntimeStatusInput } from "./runtime-events.js";

export interface ContextManagerOpts {
  /** Live handles — always resolved at use, never a stale copy. */
  readonly getClient: () => LLMClient;
  readonly getModel: () => Model;
  readonly getContext: () => LLMContext;
  readonly getChangeJournal: () => ChangeJournal;
  readonly setActiveUserMessageOrdinal: (ordinal: number) => void;
  readonly events: RuntimeEvents;
  readonly compressionThresholdRatio: number;
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

export interface ProcessUsageResult extends TokenUsageResult {
  compressed: boolean;
}

export class DefaultThresholdPolicy implements ThresholdPolicy {
  readonly thresholds = [25, 50, 75, 90] as const;

  shouldCompress(total: number, contextLength: number, ratio: number): boolean {
    const threshold = Math.floor(contextLength * ratio);
    return total > threshold;
  }
}

export class ContextManager {
  private compressionService: CompressionStrategy;
  private isCompressing = false;
  private getClient: () => LLMClient;
  private getModel: () => Model;
  private getContext: () => LLMContext;
  private getChangeJournal: () => ChangeJournal;
  private setActiveUserMessageOrdinal: (ordinal: number) => void;
  private events: RuntimeEvents;
  private compressionThresholdRatio: number;
  private sessionStats?: SessionStats;
  private thresholdPolicy: ThresholdPolicy;
  private tokenCount = 0;
  private lastShownThreshold = 0;

  constructor(opts: ContextManagerOpts) {
    this.getClient = opts.getClient;
    this.getModel = opts.getModel;
    this.getContext = opts.getContext;
    this.getChangeJournal = opts.getChangeJournal;
    this.setActiveUserMessageOrdinal = opts.setActiveUserMessageOrdinal;
    this.events = opts.events;
    this.compressionThresholdRatio = opts.compressionThresholdRatio;
    this.sessionStats = opts.sessionStats;
    this.thresholdPolicy = opts.thresholdPolicy ?? new DefaultThresholdPolicy();
    this.compressionService =
      opts.compressionStrategy ?? new SummaryCompressionStrategy();
  }

  /** Process token usage and compress context if the configured threshold is exceeded. */
  async processUsage(usage: TokenUsage): Promise<ProcessUsageResult> {
    const usageResult = this.updateTokenUsage(this.getModel().getName(), usage);
    if (!usageResult.shouldCompress) {
      return {
        ...usageResult,
        compressed: false,
      };
    }

    const compressed = await this.compress();
    return {
      ...usageResult,
      totalTokens: this.tokenCount,
      compressed,
    };
  }

  private updateTokenUsage(model: string, usage: TokenUsage): TokenUsageResult {
    const totalTokens = usage.input.total + usage.output;
    this.sessionStats?.recordUsage(model, usage);
    this.tokenCount = totalTokens;
    this.emitTokenCount();

    const contextLength = this.getModel().getContextLength();
    const ratio = totalTokens / contextLength;
    const percentage = Math.floor(ratio * 100);

    for (const threshold of this.thresholdPolicy.thresholds) {
      if (percentage >= threshold && this.lastShownThreshold < threshold) {
        this.reportStatus({
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
      this.getModel().getContextLength(),
      this.compressionThresholdRatio,
    );

    return { totalTokens, percentage, shouldCompress };
  }

  /** Compress conversation context when context window threshold is exceeded. */
  async compress(): Promise<boolean> {
    if (this.isCompressing) return false;
    this.isCompressing = true;

    try {
      const recentCount = 10;
      const context = this.getContext();
      const userMessageCount = context.getUserMessageCount();
      if (userMessageCount <= recentCount + 2) {
        this.reportStatus({
          role: "status",
          content: "Not enough conversation to compress.",
          timestamp: new Date(),
        });
        return false;
      }

      const totalTokens = this.tokenCount;
      this.reportStatus({
        role: "status",
        content: `Compressing ${userMessageCount - recentCount} user messages (${totalTokens} tokens)...`,
        timestamp: new Date(),
      });

      const originalUserPrompts = userMessageCount;

      const compressed = await this.compressionService.compress(
        context,
        this.getClient(),
        this.getModel(),
      );

      const originalKept = recentCount + 1; // compression adds 1 summary user message
      const prunedCount = originalUserPrompts - originalKept;

      if (prunedCount > 0) {
        await this.getChangeJournal().pruneAndRenumberUserMessages(
          prunedCount,
          1,
        );
      }

      context.replaceBlocks(compressed);
      this.reset();

      const newActiveIdx = context.getUserMessageCount();
      this.setActiveUserMessageOrdinal(newActiveIdx);

      this.reportStatus({
        role: "status",
        content: `Compressed: ${prunedCount} user messages removed, ${newActiveIdx} remaining.`,
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      this.reportStatus({
        role: "error",
        content: `Compression failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
      return false;
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
    this.emitTokenCount();
  }

  reset(): void {
    this.tokenCount = 0;
    this.lastShownThreshold = 0;
    this.emitTokenCount();
  }

  getIsCompressing(): boolean {
    return this.isCompressing;
  }

  private emitTokenCount(): void {
    this.events.emit({
      type: "context.tokens_changed",
      tokenCount: this.tokenCount,
    });
  }

  private reportStatus(status: RuntimeStatusInput): void {
    this.events.emit({
      type: "status.added",
      status: {
        ...status,
        userMessageIndex:
          status.userMessageIndex ?? this.getContext().getUserMessageCount(),
      },
    });
  }
}
