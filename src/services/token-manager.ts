export class TokenManager {
  private totalTokens = 0;
  private lastShownThreshold = 0;

  updateUsage(
    input: number,
    output: number,
    cacheCreation = 0,
    cacheRead = 0,
  ): void {
    // input_tokens alone does NOT include cache tokens or output tokens.
    // The actual context window usage is:
    // input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens
    this.totalTokens = input + output + cacheCreation + cacheRead;
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
