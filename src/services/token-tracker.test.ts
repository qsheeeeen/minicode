import { describe, it, expect, vi } from "vitest";
import { TokenTracker } from "./token-tracker.js";

function createTracker(
  overrides: { contextLength?: number; ratio?: number } = {},
) {
  const events = { tokenUpdate: vi.fn() };
  const store = { addStatus: vi.fn() };
  const sessionStats = { recordUsage: vi.fn(), incrementSessionCount: vi.fn() };
  const tracker = new TokenTracker(
    overrides.contextLength ?? 100000,
    overrides.ratio ?? 0.8,
    events as any,
    store as any,
    sessionStats as any,
  );
  return { tracker, events, store, sessionStats };
}

describe("TokenTracker", () => {
  it("processes usage and returns percentage", () => {
    const { tracker } = createTracker();
    const result = tracker.processUsage("test-model", 50000, 10000, 0, 0);
    expect(result.percentage).toBe(60);
    expect(result.shouldCompress).toBe(false);
  });

  it("triggers compression when threshold exceeded", () => {
    const { tracker } = createTracker();
    const result = tracker.processUsage("test-model", 85000, 5000, 0, 0);
    expect(result.shouldCompress).toBe(true);
  });

  it("records usage in sessionStats", () => {
    const { tracker, sessionStats } = createTracker();
    tracker.processUsage("model-a", 1000, 200, 50, 30);
    expect(sessionStats.recordUsage).toHaveBeenCalledWith(
      "model-a",
      1000,
      200,
      50,
      30,
    );
  });

  it("notifies events with token count", () => {
    const { tracker, events } = createTracker();
    tracker.processUsage("model", 50000, 0, 0, 0);
    expect(events.tokenUpdate).toHaveBeenCalledWith(50000);
  });

  it("adds status when crossing threshold boundary", () => {
    const { tracker, store } = createTracker();
    tracker.processUsage("model", 26000, 0, 0, 0);
    expect(store.addStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "[26% context]" }),
    );
  });

  it("does not add status below 25%", () => {
    const { tracker, store } = createTracker();
    tracker.processUsage("model", 24000, 0, 0, 0);
    expect(store.addStatus).not.toHaveBeenCalled();
  });

  it("getTotal returns current count", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", 1000, 200, 0, 0);
    expect(tracker.getTotal()).toBe(1200);
  });

  it("reset clears counter", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", 50000, 0, 0, 0);
    tracker.reset();
    expect(tracker.getTotal()).toBe(0);
  });

  it("setCount replaces counter value", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", 50000, 0, 0, 0);
    tracker.setCount(1000);
    expect(tracker.getTotal()).toBe(1000);
  });

  it("setCount with 0 resets counter", () => {
    const { tracker } = createTracker();
    tracker.processUsage("model", 50000, 0, 0, 0);
    tracker.setCount(0);
    expect(tracker.getTotal()).toBe(0);
  });
});
