import { TokenCounter } from "./token-counter.js";
import type { SessionStats } from "./session-stats.js";
import type { AgentEvents } from "../utils/display.js";
import type { MessageStore } from "../messages.js";

export class TokenTracker {
  private counter = new TokenCounter();

  constructor(
    private contextLength: number,
    private compressionThresholdRatio: number,
    private events: AgentEvents,
    private store: MessageStore,
    private sessionStats?: SessionStats,
  ) {}

  processUsage(
    model: string,
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number,
  ): { percentage: number; shouldCompress: boolean } {
    this.counter.updateUsage(input, output, cacheCreation, cacheRead);
    this.sessionStats?.recordUsage(model, input, output, cacheCreation, cacheRead);
    this.events.tokenUpdate(this.counter.getTotal());

    const ratio = this.counter.getRatio(this.contextLength);
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    const lastShown = this.counter.getLastShownThreshold();
    for (const t of thresholds) {
      if (percentage >= t && lastShown < t) {
        this.store.addStatus({
          role: "status",
          content: `[${percentage}% context]`,
          timestamp: new Date(),
        });
        this.counter.updateThreshold(t);
        break;
      }
    }

    const shouldCompress = this.counter.shouldCompress(
      this.contextLength,
      this.compressionThresholdRatio,
    );

    return { percentage, shouldCompress };
  }

  getTotal(): number {
    return this.counter.getTotal();
  }

  reset(): void {
    this.counter.reset();
  }

  /** Set token count directly (e.g. from loaded session data) */
  setCount(count: number): void {
    this.counter.reset();
    if (count > 0) {
      this.counter.updateUsage(count, 0);
    }
  }

  setContextLength(length: number): void {
    this.contextLength = length;
  }
}
