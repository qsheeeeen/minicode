// ContextManager owns compression logic, token tracking, and the reactive
// token count signal.
//
// The compress() method receives cross-manager deps as params (store, model,
// changeJournal, activeTurnIdx) to avoid coupling to other managers.
// It returns the new activeTurnIdx so the caller (Agent) can update
// SessionManager.

import type { LLMClient, TokenUsage } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { SessionStats } from "./session-stats.js";
import { Signal } from "../utils/signal.js";
import { TokenTracker } from "./token-tracker.js";
import { CompressionService } from "./compression-service.js";
import { ChangeJournal } from "./change-journal.js";
import { MessageStore } from "../messages.js";

export interface ContextManagerOpts {
  readonly contextLength: number;
  readonly compressionThresholdRatio: number;
  readonly tokenCount$: Signal<number>;
  readonly store: MessageStore;
  readonly sessionStats?: SessionStats;
}

export interface CompressDeps {
  store: MessageStore;
  model: Model;
  changeJournal: ChangeJournal;
  activeTurnIdx: number;
}

export class ContextManager {
  private tokenTracker: TokenTracker;
  private compressionService = new CompressionService();
  private isCompressing = false;
  readonly tokenCount$: Signal<number>;

  constructor(opts: ContextManagerOpts) {
    this.tokenCount$ = opts.tokenCount$;
    this.tokenTracker = new TokenTracker(
      opts.contextLength,
      opts.compressionThresholdRatio,
      opts.tokenCount$,
      opts.store,
      opts.sessionStats,
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
      const turns = deps.store.getTurns();
      if (turns.length <= recentCount + 2) {
        deps.store.addStatus({
          role: "status",
          content: "Not enough conversation to compress.",
          timestamp: new Date(),
        });
        return deps.activeTurnIdx;
      }

      const totalTokens = this.tokenTracker.getTotal();
      deps.store.addStatus({
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
        deps.store.toLLMMessages(),
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

      deps.store.setTurns(compressed);
      this.tokenTracker.reset();

      // Recalculate activeTurnIdx
      let newActiveIdx = 0;
      for (const turn of compressed) {
        if (turn.role === "user" && typeof turn.content === "string") {
          newActiveIdx++;
        }
      }

      deps.store.addStatus({
        role: "status",
        content: `Compressed: ${prunedCount} turns removed, ${compressed.length} remaining.`,
        timestamp: new Date(),
      });

      return newActiveIdx;
    } catch (error) {
      deps.store.addStatus({
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
