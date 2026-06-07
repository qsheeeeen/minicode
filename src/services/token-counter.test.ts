import { describe, it, expect } from "vitest";
import { TokenCounter } from "./token-counter.js";
import type { TokenUsage } from "../llm/client.js";

function usage(input: number, output: number, cacheMiss = 0, cacheHit = 0): TokenUsage {
  return { input: { total: input, cache_miss: cacheMiss, cache_hit: cacheHit }, output };
}

describe("TokenCounter", () => {
  describe("updateUsage", () => {
    it("sums input and output", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(1000, 200));
      expect(tc.getTotal()).toBe(1200);
    });

    it("input.total already includes cache tokens", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(1800, 200, 500, 300));
      expect(tc.getTotal()).toBe(2000);
    });

    it("sets current context window usage on each call", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(1000, 200));
      tc.updateUsage(usage(500, 100));
      expect(tc.getTotal()).toBe(600);
    });
  });

  describe("getRatio", () => {
    it("returns total / contextLength", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(50000, 0));
      expect(tc.getRatio(100000)).toBe(0.5);
    });

    it("returns 0 when no tokens", () => {
      const tc = new TokenCounter();
      expect(tc.getRatio(100000)).toBe(0);
    });
  });

  describe("shouldCompress", () => {
    it("returns true when total > contextLength * thresholdRatio", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(85000, 0));
      expect(tc.shouldCompress(100000, 0.8)).toBe(true);
    });

    it("returns false when total equals threshold", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(80000, 0));
      expect(tc.shouldCompress(100000, 0.8)).toBe(false);
    });

    it("returns false when total below threshold", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(70000, 0));
      expect(tc.shouldCompress(100000, 0.8)).toBe(false);
    });

    it("uses floor for threshold calculation", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(74999, 0));
      expect(tc.shouldCompress(100000, 0.75)).toBe(false);
      tc.updateUsage(usage(75001, 0));
      expect(tc.shouldCompress(100000, 0.75)).toBe(true);
    });
  });

  describe("threshold state", () => {
    it("getLastShownThreshold returns initial 0", () => {
      const tc = new TokenCounter();
      expect(tc.getLastShownThreshold()).toBe(0);
    });

    it("updateThreshold stores value", () => {
      const tc = new TokenCounter();
      tc.updateThreshold(0.75);
      expect(tc.getLastShownThreshold()).toBe(0.75);
    });

    it("multiple updates overwrite", () => {
      const tc = new TokenCounter();
      tc.updateThreshold(0.7);
      tc.updateThreshold(0.8);
      expect(tc.getLastShownThreshold()).toBe(0.8);
    });
  });

  describe("reset", () => {
    it("clears totalTokens to 0", () => {
      const tc = new TokenCounter();
      tc.updateUsage(usage(1000, 0));
      tc.reset();
      expect(tc.getTotal()).toBe(0);
    });

    it("clears lastShownThreshold to 0", () => {
      const tc = new TokenCounter();
      tc.updateThreshold(0.8);
      tc.reset();
      expect(tc.getLastShownThreshold()).toBe(0);
    });
  });
});
