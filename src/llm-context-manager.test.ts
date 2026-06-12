import { describe, it, expect, vi } from "vitest";
import { LLMContextManager } from "./llm-context-manager.js";
import type { MessageParam, StatusMessage } from "./messages.js";

describe("LLMContextManager", () => {
  describe("observable", () => {
    it("onChange fires on mutations and returns unsubscribe", () => {
      const mgr = new LLMContextManager();
      const listener = vi.fn();
      const unsub = mgr.onChange(listener);

      mgr.addUserMessage("hello");
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      mgr.addUserMessage("world");
      expect(listener).toHaveBeenCalledTimes(1); // no more calls after unsub
    });

    it("supports multiple listeners", () => {
      const mgr = new LLMContextManager();
      const l1 = vi.fn();
      const l2 = vi.fn();
      mgr.onChange(l1);
      mgr.onChange(l2);

      mgr.addUserMessage("hi");
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("addUserMessage", () => {
    it("appends a user turn", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("hello");

      const turns = mgr.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0]).toEqual({ role: "user", content: "hello" });
    });

    it("stores display override when displayContent differs", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("raw content", "display content");

      const msgs = mgr.toDisplayMessages([]);
      expect(msgs[0]).toEqual({ role: "user", content: "display content" });
    });

    it("notifies onChange", () => {
      const mgr = new LLMContextManager();
      const listener = vi.fn();
      mgr.onChange(listener);

      mgr.addUserMessage("hi");
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("assistant turns", () => {
    it("startAssistantTurn creates empty assistant turn", () => {
      const mgr = new LLMContextManager();
      mgr.startAssistantTurn();

      const turns = mgr.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].content).toEqual([]);
    });

    it("appendToLastAssistantTurn appends block to existing turn", () => {
      const mgr = new LLMContextManager();
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "hello" });

      const turns = mgr.getTurns();
      expect(turns[0].content).toEqual([{ type: "text", text: "hello" }]);
    });

    it("appendToLastAssistantTurn creates turn if needed", () => {
      const mgr = new LLMContextManager();
      mgr.appendToLastAssistantTurn({ type: "text", text: "auto" });

      const turns = mgr.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe("assistant");
    });

    it("updateLastBlock mutates last block text", () => {
      const mgr = new LLMContextManager();
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "hel" });
      mgr.updateLastBlock({ text: "hello" });

      const turns = mgr.getTurns();
      expect((turns[0].content as any[])[0].text).toBe("hello");
    });

    it("updateLastBlock does nothing if no assistant turn", () => {
      const mgr = new LLMContextManager();
      // Should not throw
      mgr.updateLastBlock({ text: "nope" });
      expect(mgr.getTurns()).toHaveLength(0);
    });

    it("getLastBlock returns last block of last assistant turn", () => {
      const mgr = new LLMContextManager();
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "first" });
      mgr.appendToLastAssistantTurn({ type: "text", text: "second" });

      expect(mgr.getLastBlock()).toEqual({ type: "text", text: "second" });
    });

    it("getLastBlock returns undefined if no assistant turn", () => {
      const mgr = new LLMContextManager();
      expect(mgr.getLastBlock()).toBeUndefined();
    });
  });

  describe("addToolResults", () => {
    it("adds a user turn with tool_result blocks", () => {
      const mgr = new LLMContextManager();
      mgr.addToolResults([
        { toolUseId: "id1", content: "result1" },
        { toolUseId: "id2", content: "result2" },
      ]);

      const turns = mgr.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe("user");
      expect((turns[0].content as any[])).toHaveLength(2);
      expect((turns[0].content as any[])[0]).toEqual({
        type: "tool_result",
        tool_use_id: "id1",
        content: "result1",
      });
    });

    it("does nothing with empty results", () => {
      const mgr = new LLMContextManager();
      mgr.addToolResults([]);
      expect(mgr.getTurns()).toHaveLength(0);
    });
  });

  describe("setTurns / removeLastTurn", () => {
    it("setTurns replaces all turns", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("old1");
      mgr.addUserMessage("old2");

      const newTurns: MessageParam[] = [
        { role: "user", content: "new" } as MessageParam,
      ];
      mgr.setTurns(newTurns);

      expect(mgr.getTurns()).toEqual(newTurns);
    });

    it("setTurns clears display overrides", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("raw", "display");
      mgr.setTurns([]);

      // Display override should be gone
      const msgs = mgr.toDisplayMessages([]);
      expect(msgs).toHaveLength(0);
    });

    it("removeLastTurn removes if predicate matches", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("keep");
      mgr.startAssistantTurn();

      const removed = mgr.removeLastTurn((t) => t.role === "assistant");
      expect(removed).toBe(true);
      expect(mgr.getTurns()).toHaveLength(1);
    });

    it("removeLastTurn does not remove if predicate fails", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("keep");

      const removed = mgr.removeLastTurn((t) => t.role === "assistant");
      expect(removed).toBe(false);
      expect(mgr.getTurns()).toHaveLength(1);
    });
  });

  describe("clear", () => {
    it("removes all turns", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("a");
      mgr.addUserMessage("b");
      mgr.clear();

      expect(mgr.getTurns()).toHaveLength(0);
    });

    it("notifies onChange", () => {
      const mgr = new LLMContextManager();
      const listener = vi.fn();
      mgr.onChange(listener);
      mgr.clear();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("getTurnCount", () => {
    it("returns current turn count", () => {
      const mgr = new LLMContextManager();
      expect(mgr.getTurnCount()).toBe(0);

      mgr.addUserMessage("a");
      expect(mgr.getTurnCount()).toBe(1);

      mgr.startAssistantTurn();
      expect(mgr.getTurnCount()).toBe(2);
    });
  });

  describe("streaming state", () => {
    it("setStreaming toggles state", () => {
      const mgr = new LLMContextManager();
      expect(mgr.isStreaming()).toBe(false);

      mgr.setStreaming(true);
      expect(mgr.isStreaming()).toBe(true);

      mgr.setStreaming(false);
      expect(mgr.isStreaming()).toBe(false);
    });

    it("setStreaming notifies only on change", () => {
      const mgr = new LLMContextManager();
      const listener = vi.fn();
      mgr.onChange(listener);

      mgr.setStreaming(false); // no change
      expect(listener).not.toHaveBeenCalled();

      mgr.setStreaming(true); // change
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("toDisplayMessages", () => {
    it("converts turns without statuses", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("hello");
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "world" });

      const msgs = mgr.toDisplayMessages();
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: "user", content: "hello" });
      expect(msgs[1]).toEqual({ role: "text", content: "world" });
    });

    it("interleaves statuses by turnIndex", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("hello");
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "world" });

      const statuses: StatusMessage[] = [
        { role: "status", content: "status after turn 0", turnIndex: 1, timestamp: new Date() },
        { role: "status", content: "status at end", turnIndex: 3, timestamp: new Date() },
      ];

      const msgs = mgr.toDisplayMessages(statuses);
      // user(0), status(turnIndex=1), assistant(1), status(turnIndex=3)
      expect(msgs).toHaveLength(4);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("status");
      expect(msgs[2].role).toBe("text");
      expect(msgs[3].role).toBe("status");
    });

    it("marks last text/thinking block as streaming", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("hello");
      mgr.startAssistantTurn();
      mgr.appendToLastAssistantTurn({ type: "text", text: "streaming..." });
      mgr.setStreaming(true);

      const msgs = mgr.toDisplayMessages([]);
      const textMsg = msgs.find((m) => m.role === "text");
      expect(textMsg).toBeDefined();
      expect((textMsg as any).isStreaming).toBe(true);
    });

    it("uses display overrides for user messages", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("raw content", "display content");

      const msgs = mgr.toDisplayMessages([]);
      expect(msgs[0]).toEqual({ role: "user", content: "display content" });
    });
  });

  describe("getTurns returns a copy", () => {
    it("mutations to returned array do not affect internal state", () => {
      const mgr = new LLMContextManager();
      mgr.addUserMessage("hello");

      const turns = mgr.getTurns();
      turns.push({ role: "user", content: "injected" } as MessageParam);

      expect(mgr.getTurns()).toHaveLength(1);
    });
  });
});
