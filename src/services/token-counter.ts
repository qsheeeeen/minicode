import type { TokenUsage } from "../llm/client.js";

export class TokenCounter {
  private totalTokens = 0;
  private lastShownThreshold = 0;

  updateUsage(usage: TokenUsage): void {
    this.totalTokens = usage.input.total + usage.output;
  }

  getTotal(): number {
    return this.totalTokens;
  }

  getRatio(contextLength: number): number {
    return this.totalTokens / contextLength;
  }

  shouldCompress(contextLength: number, thresholdRatio: number): boolean {
    const threshold = Math.floor(contextLength * thresholdRatio);
    return this.totalTokens > threshold;
  }

  getLastShownThreshold(): number {
    return this.lastShownThreshold;
  }

  updateThreshold(value: number): void {
    this.lastShownThreshold = value;
  }

  reset(): void {
    this.totalTokens = 0;
    this.lastShownThreshold = 0;
  }
}
