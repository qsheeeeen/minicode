import { describe, it, expect } from "vitest";
import { ContextManager } from "./context-manager.js";
import { Signal } from "../utils/signal.js";
import { MessageStore } from "../messages.js";

function createContextManager(overrides?: {
  compressionThresholdRatio?: number;
}) {
  const tokenCount$ = new Signal(0);
  const store = new MessageStore();
  const cm = new ContextManager({
    contextLength: 200000,
    compressionThresholdRatio: overrides?.compressionThresholdRatio ?? 0.8,
    tokenCount$,
    store,
  });
  return { cm, tokenCount$, store };
}

describe("ContextManager", () => {
  describe("constructor", () => {
    it("creates instance with required opts", () => {
      const { cm } = createContextManager();
      expect(cm).toBeDefined();
      expect(cm.getTokenCount()).toBe(0);
    });

    it("exposes the tokenCount$ signal", () => {
      const { cm, tokenCount$ } = createContextManager();
      expect(cm.tokenCount$).toBe(tokenCount$);
    });
  });

  describe("processTokenUsage", () => {
    it("returns false for small usage", () => {
      const { cm } = createContextManager();
      const result = cm.processTokenUsage("test-model", {
        input: { total: 100, prompt: 100, cache_read: 0, cache_creation: 0 },
        output: 50,
      });
      expect(result).toBe(false);
    });

    it("returns true when exceeding threshold", () => {
      const { cm } = createContextManager({ compressionThresholdRatio: 0.5 });
      // contextLength=200000, threshold=0.5 → compress at 100000
      const result = cm.processTokenUsage("test-model", {
        input: { total: 150000, prompt: 150000, cache_read: 0, cache_creation: 0 },
        output: 50000,
      });
      expect(result).toBe(true);
    });

    it("returns false for empty usage", () => {
      const { cm } = createContextManager();
      const result = cm.processTokenUsage("test-model", {
        input: { total: 0, prompt: 0, cache_read: 0, cache_creation: 0 },
        output: 0,
      });
      expect(result).toBe(false);
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
    it("returns activeTurnIdx unchanged when not enough turns", async () => {
      const { cm, store } = createContextManager();
      const newIdx = await cm.compress({
        store,
        model: {} as any,
        changeJournal: {} as any,
        activeTurnIdx: 3,
      });
      expect(newIdx).toBe(3);
    });
  });
});
