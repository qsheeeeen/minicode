/**
 * Token management service for tracking LLM usage
 */
export interface TokenManager {
  addTokens(input: number, output: number): void;
  getTotal(): number;
  getRatio(contextLength: number): number;
  shouldCompress(contextLength: number, thresholdRatio: number): boolean;
  getLastShownThreshold(): number;
  updateThreshold(value: number): void;
  reset(): void;
}

export class TokenManagerImpl implements TokenManager {
  private totalTokens = 0;
  private lastShownThreshold = 0;

  addTokens(input: number, output: number): void {
    this.totalTokens += input + output;
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
