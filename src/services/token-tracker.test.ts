import { describe, it, expect, vi } from "vitest";
import { TokenTracker } from "./token-tracker.js";
import type { TokenUsage } from "../llm/client.js";
import { Signal } from "../utils/signal.js";

function usage(input: number, output: number, cacheMiss = 0, cacheHit = 0): TokenUsage {
  return { input: { total: input, cache_miss: cacheMiss, cache_hit: cacheHit }, output };
}

function createTracker(
  overrides: { contextLength?: number; ratio?: number } = {},
) {
  const tokenCount = new Signal(0);
  const store = { addStatus: vi.fn() };
  const sessionStats = { recordUsage: vi.fn(), incrementSessionCount: vi.fn() };
  const tracker = new TokenTracker(
    overrides.contextLength ?? 100000,
    overrides.ratio ?? 0.8,
    tokenCount,
    store as any,
    sessionStats as any,
  );
  return { tracker, tokenCount, store, sessionStats };
}

describe("TokenTracker", () => {
  it("processes usage and returns percentage", () => {
    const { tracker } = createTracker();
    const result = tracker.processUsage("test-model", usage(50000, 10000));
    expect(result.percentage).toBe(60);
    expect(result.shouldCompress).toBe(false);
  });

  it("triggers compression when threshold exceeded", () => {
    const { tracker } = createTracker();
    const result = tracker.processUsage("test-model", usage(85000, 5000));
    expect(result.shouldCompress).toBe(true);
  });

  it("records usage in sessionStats", () => {
    const { tracker, sessionStats } = createTracker();
    const u = usage(1000, 200, 50, 30);
    tracker.processUsage("model-a", u);
    expect(sessionStats.recordUsage).toHaveBeenCalledWith("model-a", u);
  });

  it("notifies signal with token count", () => {
    const { tracker, tokenCount } = createTracker();
    tracker.processUsage("model", usage(50000, 0));
    expect(tokenCount.get()).toBe(50000);
  });

  it("adds status when crossing threshold boundary", () => {
    const { tracker, store } = createTracker();
    tracker.processUsage("model", usage(26000, 0));
    expect(store.addStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "[26% context]" }),
    );
  });

  it("does not add status below 25%", () => {
    const { tracker, store } = createTracker();
    tracker.processUsage("model", usage(24000, 0));
    expect(store.addStatus).not.toHaveBeenCalled();
  });

  it("getTotal returns current count", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(1000, 200));
    expect(tracker.getTotal()).toBe(1200);
  });

  it("reset clears counter", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(50000, 0));
    tracker.reset();
    expect(tracker.getTotal()).toBe(0);
  });

  it("setCount replaces counter value", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(50000, 0));
    tracker.setCount(1000);
    expect(tracker.getTotal()).toBe(1000);
  });

  it("setCount with 0 resets counter", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(50000, 0));
    tracker.setCount(0);
    expect(tracker.getTotal()).toBe(0);
  });

  it("replaces total on each call (not accumulates)", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(1000, 200));
    tracker.processUsage("model", usage(500, 100));
    expect(tracker.getTotal()).toBe(600);
  });

  it("input.total includes cache tokens", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", usage(1800, 200, 500, 300));
    expect(tracker.getTotal()).toBe(2000);
  });

  it("shouldCompress uses floor for threshold", () => {
    const { tracker } = createTracker({ contextLength: 100000, ratio: 0.75 });
    let r = tracker.processUsage("model", usage(74999, 0));
    expect(r.shouldCompress).toBe(false);
    r = tracker.processUsage("model", usage(75001, 0));
    expect(r.shouldCompress).toBe(true);
  });

  it("returns 0 percentage when no tokens", () => {
    const { tracker } = createTracker({ contextLength: 100000 });
    tracker.setCount(0);
    expect(tracker.getTotal()).toBe(0);
  });
});
