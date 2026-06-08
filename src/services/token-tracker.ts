import type { SessionStats } from "./session-stats.js";
import type { AgentEvents } from "../utils/display.js";
import type { MessageStore } from "../messages.js";
import type { TokenUsage } from "../llm/client.js";

export class TokenTracker {
  private totalTokens = 0;
  private lastShownThreshold = 0;

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
    this.totalTokens = usage.input.total + usage.output;
    this.sessionStats?.recordUsage(model, usage);
    this.events.tokenUpdate(this.totalTokens);

    const ratio = this.totalTokens / this.contextLength;
    const percentage = Math.floor(ratio * 100);

    const thresholds = [25, 50, 75, 90];
    for (const t of thresholds) {
      if (percentage >= t && this.lastShownThreshold < t) {
        this.store.addStatus({
          role: "status",
          content: `[${percentage}% context]`,
          timestamp: new Date(),
        });
        this.lastShownThreshold = t;
        break;
      }
    }

    const threshold = Math.floor(this.contextLength * this.compressionThresholdRatio);
    const shouldCompress = this.totalTokens > threshold;

    return { percentage, shouldCompress };
  }

  getTotal(): number {
    return this.totalTokens;
  }

  reset(): void {
    this.totalTokens = 0;
    this.lastShownThreshold = 0;
  }

  setCount(count: number): void {
    this.totalTokens = count;
    this.lastShownThreshold = 0;
  }

  setContextLength(length: number): void {
    this.contextLength = length;
  }
}
