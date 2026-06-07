import { TokenCounter } from "./token-counter.js";
import type { SessionStats } from "./session-stats.js";
import type { AgentEvents } from "../utils/display.js";
import type { MessageStore } from "../messages.js";
import type { TokenUsage } from "../llm/client.js";

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
    usage: TokenUsage,
  ): { percentage: number; shouldCompress: boolean } {
    this.counter.updateUsage(usage);
    this.sessionStats?.recordUsage(model, usage);
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

  // Set token count directly (e.g. from loaded session data)
  setCount(count: number): void {
    this.counter.reset();
    if (count > 0) {
      this.counter.updateUsage({ input: { total: count, cache_miss: 0, cache_hit: 0 }, output: 0 });
    }
  }

  setContextLength(length: number): void {
    this.contextLength = length;
  }
}
