import { describe, it, expect } from "vitest";
import { TokenCounter } from "./token-counter.js";

describe("TokenCounter", () => {
  describe("updateUsage", () => {
    it("sums input and output when no cache tokens", () => {
      const tc = new TokenCounter();
      tc.updateUsage(1000, 200);
      expect(tc.getTotal()).toBe(1200);
    });

    it("includes cacheCreation tokens", () => {
      const tc = new TokenCounter();
      tc.updateUsage(1000, 200, 500);
      expect(tc.getTotal()).toBe(1700);
    });

    it("includes cacheRead tokens", () => {
      const tc = new TokenCounter();
      tc.updateUsage(1000, 200, 0, 300);
      expect(tc.getTotal()).toBe(1500);
    });

    it("sums all token types", () => {
      const tc = new TokenCounter();
      tc.updateUsage(1000, 200, 500, 300);
      expect(tc.getTotal()).toBe(2000);
    });

    it("sets current context window usage on each call", () => {
      const tc = new TokenCounter();
      tc.updateUsage(1000, 200);
      tc.updateUsage(500, 100);
      expect(tc.getTotal()).toBe(600);
    });
  });

  describe("getRatio", () => {
    it("returns total / contextLength", () => {
      const tc = new TokenCounter();
      tc.updateUsage(50000, 0);
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
      tc.updateUsage(85000, 0);
      expect(tc.shouldCompress(100000, 0.8)).toBe(true);
    });

    it("returns false when total equals threshold", () => {
      const tc = new TokenCounter();
      tc.updateUsage(80000, 0);
      expect(tc.shouldCompress(100000, 0.8)).toBe(false);
    });

    it("returns false when total below threshold", () => {
      const tc = new TokenCounter();
      tc.updateUsage(70000, 0);
      expect(tc.shouldCompress(100000, 0.8)).toBe(false);
    });

    it("uses floor for threshold calculation", () => {
      const tc = new TokenCounter();
      tc.updateUsage(74999, 0);
      expect(tc.shouldCompress(100000, 0.75)).toBe(false);
      tc.updateUsage(75001, 0);
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
      tc.updateUsage(1000, 0);
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
