// ContextManager owns compression logic, token tracking, and the reactive
// token count signal.
//
// The compress() method receives cross-manager deps as params (context, model,
// changeJournal, activeTurnIdx, statusReporter) to avoid coupling to other managers.
// It returns the new activeTurnIdx so the caller (Agent) can update
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
import type { LLMContextManager } from "../llm-context-manager.js";
import type { StatusReporter } from "./session-manager.js";

export interface ContextManagerOpts {
  readonly contextLength: number;
  readonly compressionThresholdRatio: number;
  readonly tokenCount$: Signal<number>;
  readonly contextManager: LLMContextManager;
  readonly statusReporter: StatusReporter;
  readonly sessionStats?: SessionStats;
  readonly compressionStrategy?: CompressionStrategy;
  readonly thresholdPolicy?: import("./token-tracker.js").ThresholdPolicy;
}

export interface CompressDeps {
  context: LLMContextManager;
  model: Model;
  changeJournal: ChangeJournal;
  activeTurnIdx: number;
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
   * Compress conversation history when context window threshold is exceeded.
   * Receives cross-manager deps as params. Returns the new activeTurnIdx.
   */
  async compress(deps: CompressDeps): Promise<number> {
    if (this.isCompressing) return deps.activeTurnIdx;
    this.isCompressing = true;

    try {
      const recentCount = 10;
      const turns = deps.context.getTurns();
      if (turns.length <= recentCount + 2) {
        deps.statusReporter({
          role: "status",
          content: "Not enough conversation to compress.",
          timestamp: new Date(),
        });
        return deps.activeTurnIdx;
      }

      const totalTokens = this.tokenTracker.getTotal();
      deps.statusReporter({
        role: "status",
        content: `Compressing ${turns.length - recentCount} turns (${totalTokens} tokens)...`,
        timestamp: new Date(),
      });

      // Count original user prompts
      let originalUserPrompts = 0;
      for (const turn of turns) {
        if (turn.role === "user" && typeof turn.content === "string") {
          originalUserPrompts++;
        }
      }

      const compressed = await this.compressionService.compress(
        deps.context.toLLMMessages(),
        deps.model.getClient() as LLMClient,
        deps.model.getName(),
      );

      // Count kept user prompts in compressed result
      let keptUserPrompts = 0;
      for (const turn of compressed) {
        if (turn.role === "user" && typeof turn.content === "string") {
          keptUserPrompts++;
        }
      }
      const originalKept = keptUserPrompts - 1; // compression adds 1 summary
      const prunedCount = originalUserPrompts - originalKept;

      if (prunedCount > 0) {
        deps.changeJournal.pruneAndRenumber(prunedCount, 1);
      }

      deps.context.setTurns(compressed);
      this.tokenTracker.reset();

      // Recalculate activeTurnIdx
      let newActiveIdx = 0;
      for (const turn of compressed) {
        if (turn.role === "user" && typeof turn.content === "string") {
          newActiveIdx++;
        }
      }

      deps.statusReporter({
        role: "status",
        content: `Compressed: ${prunedCount} turns removed, ${compressed.length} remaining.`,
        timestamp: new Date(),
      });

      return newActiveIdx;
    } catch (error) {
      deps.statusReporter({
        role: "error",
        content: `Compression failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
      return deps.activeTurnIdx;
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
