import { describe, it, expect, vi } from "vitest";
import { ContextManager } from "./context-manager.js";
import { LLMContext } from "../llm/context.js";
import type { TokenUsage } from "../llm/client.js";

function usage(
  input: number,
  output: number,
  cacheMiss = 0,
  cacheHit = 0,
): TokenUsage {
  return {
    input: { total: input, cache_miss: cacheMiss, cache_hit: cacheHit },
    output,
  };
}

function createContextManager(overrides?: {
  compressionThresholdRatio?: number;
  contextLength?: number;
}) {
  const context = new LLMContext();
  const statusReporter = vi.fn();
  const sessionStats = {
    recordUsage: vi.fn(),
    incrementSessionCount: vi.fn(),
  } as any;
  const cm = new ContextManager({
    contextLength: overrides?.contextLength ?? 200000,
    compressionThresholdRatio: overrides?.compressionThresholdRatio ?? 0.8,
    statusReporter,
    sessionStats,
  });
  return { cm, context, statusReporter, sessionStats };
}

describe("ContextManager", () => {
  describe("constructor", () => {
    it("creates instance with required opts", () => {
      const { cm } = createContextManager();
      expect(cm).toBeDefined();
      expect(cm.getTokenCount()).toBe(0);
    });

  });

  describe("processTokenUsage", () => {
    it("returns token totals and false for small usage", () => {
      const { cm } = createContextManager();
      const result = cm.processTokenUsage("test-model", usage(100, 50));
      expect(result).toEqual({
        totalTokens: 150,
        percentage: 0,
        shouldCompress: false,
      });
    });

    it("returns true when exceeding threshold", () => {
      const { cm } = createContextManager({ compressionThresholdRatio: 0.5 });
      // contextLength=200000, threshold=0.5 → compress at 100000
      const result = cm.processTokenUsage("test-model", usage(150000, 50000));
      expect(result.shouldCompress).toBe(true);
    });

    it("returns false for empty usage", () => {
      const { cm } = createContextManager();
      const result = cm.processTokenUsage("test-model", usage(0, 0));
      expect(result.shouldCompress).toBe(false);
      expect(result.percentage).toBe(0);
    });

    it("records usage in sessionStats", () => {
      const { cm, sessionStats } = createContextManager();
      const u = usage(1000, 200, 50, 30);
      cm.processTokenUsage("model-a", u);
      expect(sessionStats.recordUsage).toHaveBeenCalledWith("model-a", u);
    });

    it("updates token count", () => {
      const { cm } = createContextManager();
      cm.processTokenUsage("model", usage(50000, 0));
      expect(cm.getTokenCount()).toBe(50000);
    });

    it("calls statusReporter when crossing threshold boundary", () => {
      const { cm, statusReporter } = createContextManager({
        contextLength: 100000,
      });
      cm.processTokenUsage("model", usage(26000, 0));
      expect(statusReporter).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status", content: "[26% context]" }),
      );
    });

    it("does not call statusReporter below 25%", () => {
      const { cm, statusReporter } = createContextManager({
        contextLength: 100000,
      });
      cm.processTokenUsage("model", usage(24000, 0));
      expect(statusReporter).not.toHaveBeenCalled();
    });

    it("replaces total on each call instead of accumulating", () => {
      const { cm } = createContextManager();
      cm.processTokenUsage("model", usage(1000, 200));
      cm.processTokenUsage("model", usage(500, 100));
      expect(cm.getTokenCount()).toBe(600);
    });

    it("shouldCompress uses floor for threshold", () => {
      const { cm } = createContextManager({
        contextLength: 100000,
        compressionThresholdRatio: 0.75,
      });
      let result = cm.processTokenUsage("model", usage(74999, 0));
      expect(result.shouldCompress).toBe(false);
      result = cm.processTokenUsage("model", usage(75001, 0));
      expect(result.shouldCompress).toBe(true);
    });
  });

  describe("token count", () => {
    it("starts at 0", () => {
      const { cm } = createContextManager();
      expect(cm.getTokenCount()).toBe(0);
    });

    it("can be set manually", () => {
      const { cm } = createContextManager();
      cm.setTokenCount(5000);
      expect(cm.getTokenCount()).toBe(5000);
    });
  });

  describe("reset", () => {
    it("resets token count to 0", () => {
      const { cm } = createContextManager();
      cm.setTokenCount(10000);
      cm.reset();
      expect(cm.getTokenCount()).toBe(0);
    });
  });

  describe("compress", () => {
    it("returns activeUserMessageOrdinal unchanged when not enough user messages", async () => {
      const { cm, context, statusReporter } = createContextManager();
      const newIdx = await cm.compress({
        context,
        model: {} as any,
        changeJournal: {} as any,
        activeUserMessageOrdinal: 3,
        statusReporter,
      });
      expect(newIdx).toBe(3);
    });
  });
});
