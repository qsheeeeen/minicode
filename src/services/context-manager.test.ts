import { describe, it, expect, vi } from "vitest";
import { ContextManager } from "./context-manager.js";
import { RuntimeEvents } from "./runtime-events.js";
import { LLMContext } from "../core/context.js";
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
  compressionStrategy?: any;
  modelName?: string;
}) {
  const context = new LLMContext();
  const journal = changeJournal();
  const events = new RuntimeEvents();
  let activeMessageId = "initial";
  const sessionStats = {
    recordUsage: vi.fn(),
    incrementSessionCount: vi.fn(),
  } as any;
  const cm = new ContextManager({
    getClient: () => ({}) as any,
    getModel: () =>
      model(
        overrides?.modelName ?? "test-model",
        overrides?.contextLength ?? 200000,
      ),
    getContext: () => context,
    getChangeJournal: () => journal,
    setActiveMessageId: (id) => {
      activeMessageId = id;
    },
    events,
    compressionThresholdRatio: overrides?.compressionThresholdRatio ?? 0.8,
    sessionStats,
    compressionStrategy: overrides?.compressionStrategy,
  });
  return {
    cm,
    context,
    journal,
    events,
    sessionStats,
    getActiveMessageId: () => activeMessageId,
  };
}

function model(name = "test-model", contextLength = 200000) {
  return {
    getName: () => name,
    getContextLength: () => contextLength,
  } as any;
}

function changeJournal() {
  return {
    pruneByMessageIds: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function processUsage(cm: ContextManager, tokenUsage: TokenUsage) {
  return cm.processUsage(tokenUsage);
}

describe("ContextManager", () => {
  describe("constructor", () => {
    it("creates instance with required opts", () => {
      const { cm } = createContextManager();
      expect(cm).toBeDefined();
      expect(cm.getTokenCount()).toBe(0);
    });
  });

  describe("processUsage", () => {
    it("returns token totals and false for small usage", async () => {
      const { cm } = createContextManager();
      const result = await processUsage(cm, usage(100, 50));
      expect(result).toMatchObject({
        totalTokens: 150,
        percentage: 0,
        shouldCompress: false,
        compressed: false,
      });
    });

    it("returns true when exceeding threshold", async () => {
      const { cm } = createContextManager({
        compressionThresholdRatio: 0.5,
      });
      // contextLength=200000, threshold=0.5 → compress at 100000
      const result = await processUsage(cm, usage(150000, 50000));
      expect(result.shouldCompress).toBe(true);
    });

    it("returns false for empty usage", async () => {
      const { cm } = createContextManager();
      const result = await processUsage(cm, usage(0, 0));
      expect(result.shouldCompress).toBe(false);
      expect(result.percentage).toBe(0);
    });

    it("records usage in sessionStats", async () => {
      const { cm, sessionStats } = createContextManager({
        modelName: "model-a",
      });
      const u = usage(1000, 200, 50, 30);
      await processUsage(cm, u);
      expect(sessionStats.recordUsage).toHaveBeenCalledWith("model-a", u);
    });

    it("updates token count", async () => {
      const { cm } = createContextManager();
      await processUsage(cm, usage(50000, 0));
      expect(cm.getTokenCount()).toBe(50000);
    });

    it("emits token change events", async () => {
      const { cm, events } = createContextManager();
      const listener = vi.fn();
      events.subscribe(listener);

      await processUsage(cm, usage(50000, 0));

      expect(listener).toHaveBeenCalledWith({
        type: "context.tokens_changed",
        tokenCount: 50000,
      });
    });

    it("emits status event when crossing threshold boundary", async () => {
      const { cm, events } = createContextManager({
        contextLength: 100000,
      });
      const listener = vi.fn();
      events.subscribe(listener);

      await processUsage(cm, usage(26000, 0));

      expect(listener).toHaveBeenCalledWith({
        type: "status.added",
        status: expect.objectContaining({
          role: "status",
          content: "[26% context]",
        }),
      });
    });

    it("does not emit status event below 25%", async () => {
      const { cm, events } = createContextManager({
        contextLength: 100000,
      });
      const listener = vi.fn();
      events.subscribe(listener);

      await processUsage(cm, usage(24000, 0));

      expect(listener).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "status.added" }),
      );
    });

    it("replaces total on each call instead of accumulating", async () => {
      const { cm } = createContextManager();
      await processUsage(cm, usage(1000, 200));
      await processUsage(cm, usage(500, 100));
      expect(cm.getTokenCount()).toBe(600);
    });

    it("shouldCompress uses floor for threshold", async () => {
      const { cm } = createContextManager({
        contextLength: 100000,
        compressionThresholdRatio: 0.75,
      });
      let result = await processUsage(cm, usage(74999, 0));
      expect(result.shouldCompress).toBe(false);
      result = await processUsage(cm, usage(75001, 0));
      expect(result.shouldCompress).toBe(true);
    });

    it("compresses internally when usage exceeds threshold", async () => {
      const compressedBlocks = [
        { type: "user" as const, id: "summary-1", text: "summary" },
        { type: "text" as const, text: "kept" },
      ];
      const compressionStrategy = {
        compress: vi.fn().mockImplementation(async (ctx) => ({
          blocks: compressedBlocks,
          keptUserMessages: 11,
          // Report the first two (oldest) messages as folded into the summary.
          droppedMessageIds: ctx
            .getUserMessageSummaries()
            .slice(0, 2)
            .map((s: { id: string }) => s.id),
        })),
      };
      const { cm, context, journal, getActiveMessageId } =
        createContextManager({
          contextLength: 100,
          compressionThresholdRatio: 0.5,
          compressionStrategy,
        });
      for (let i = 0; i < 13; i += 1) {
        context.startUserMessage(`message ${i}`);
      }
      const originalIds = context
        .getUserMessageSummaries()
        .map((s) => s.id);

      const result = await processUsage(cm, usage(80, 0));

      expect(compressionStrategy.compress).toHaveBeenCalled();
      // The two dropped ids are exactly what the journal prunes.
      expect(journal.pruneByMessageIds).toHaveBeenCalledWith(
        new Set(originalIds.slice(0, 2)),
      );
      expect(context.getBlocks()).toEqual([
        expect.objectContaining({ type: "user", id: "summary-1", text: "summary" }),
        { type: "text", text: "kept" },
      ]);
      expect(result).toMatchObject({
        totalTokens: 0,
        shouldCompress: true,
        compressed: true,
      });
      // Active id follows the new last user message (the summary).
      expect(getActiveMessageId()).toBe("summary-1");
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
    it("returns false when not enough user messages", async () => {
      const { cm, events, getActiveMessageId } = createContextManager();
      const listener = vi.fn();
      events.subscribe(listener);

      const compressed = await cm.compress();
      expect(compressed).toBe(false);
      expect(getActiveMessageId()).toBe("initial");
      expect(listener).toHaveBeenCalledWith({
        type: "status.added",
        status: expect.objectContaining({
          role: "status",
          content: "Not enough conversation to compress.",
        }),
      });
    });
  });
});
