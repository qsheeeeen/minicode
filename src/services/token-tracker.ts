import type { SessionStats } from "./session-stats.js";
import type { StatusReporter } from "./session-manager.js";
import type { TokenUsage } from "../llm/client.js";
import type { Signal } from "../utils/signal.js";

export class TokenTracker {
  private lastShownThreshold = 0;

  constructor(
    private contextLength: number,
    private compressionThresholdRatio: number,
    private tokenCount: Signal<number>,
    private statusReporter: StatusReporter,
    private sessionStats?: SessionStats,
  ) {}

  processUsage(
    model: string,
    usage: TokenUsage,
  ): { percentage: number; shouldCompress: boolean } {
    const total = usage.input.total + usage.output;
    this.sessionStats?.recordUsage(model, usage);
    this.tokenCount.set(total);

    const ratio = total / this.contextLength;
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    for (const t of thresholds) {
      if (percentage >= t && this.lastShownThreshold < t) {
        this.statusReporter({
          role: "status",
          content: `[${percentage}% context]`,
          timestamp: new Date(),
        });
        this.lastShownThreshold = t;
        break;
      }
    }

    const threshold = Math.floor(this.contextLength * this.compressionThresholdRatio);
    const shouldCompress = total > threshold;

    return { percentage, shouldCompress };
  }

  getTotal(): number {
    return this.tokenCount.get();
  }

  reset(): void {
    this.tokenCount.set(0);
    this.lastShownThreshold = 0;
  }

  setCount(count: number): void {
    this.tokenCount.set(count);
    this.lastShownThreshold = 0;
  }

  setContextLength(length: number): void {
    this.contextLength = length;
  }
}
