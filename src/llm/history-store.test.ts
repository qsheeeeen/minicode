import { describe, it, expect, vi } from "vitest";
import { LLMHistory } from "./history-store.js";
import type { LLMTurn } from "./history.js";

describe("LLMHistory", () => {
  it("notifies subscribers on mutations and returns unsubscribe", () => {
    const store = new LLMHistory();
    const listener = vi.fn();
    const unsub = store.onChange(listener);

    store.startTurn("hello");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.startTurn("world");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("starts turns and returns defensive copies", () => {
    const store = new LLMHistory();
    store.startTurn("hello");

    const turns = store.getTurns();
    expect(turns).toEqual([{ userText: "hello", process: [] }]);

    turns.push({ userText: "injected", process: [] });
    expect(store.getTurns()).toHaveLength(1);
  });

  it("accumulates consecutive thinking deltas into one block", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.appendThinking("plan");
    store.appendThinking(" more");

    expect(store.getTurns()[0].process).toEqual([
      { type: "thinking", thinking: "plan more" },
    ]);
  });

  it("creates a new thinking block after a tool call", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.appendThinking("first");
    store.startToolCall("t1", "read", { path: "a.ts" });
    store.appendThinking("second");

    expect(store.getTurns()[0].process).toEqual([
      { type: "thinking", thinking: "first" },
      { type: "tool_call", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "thinking", thinking: "second" },
    ]);
  });

  it("starts and completes tool calls", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.startToolCall("t1", "read", { path: "a.ts" });
    store.completeToolCall("t1", "content");

    expect(store.getTurns()[0].process).toEqual([
      {
        type: "tool_call",
        id: "t1",
        name: "read",
        input: { path: "a.ts" },
        result: "content",
      },
    ]);
  });

  it("overwrites repeated tool results", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.startToolCall("t1", "read", {});
    store.completeToolCall("t1", "one");
    store.completeToolCall("t1", "two");

    expect(store.getTurns()[0].process).toEqual([
      { type: "tool_call", id: "t1", name: "read", input: {}, result: "two" },
    ]);
  });

  it("rejects duplicate tool call ids in the current turn", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.startToolCall("t1", "read", {});

    expect(() => store.startToolCall("t1", "read", {})).toThrow(
      "Duplicate tool call id",
    );
  });

  it("throws when completing a missing tool call", () => {
    const store = new LLMHistory();
    store.startTurn("task");

    expect(() => store.completeToolCall("missing", "result")).toThrow(
      "Tool call not found",
    );
  });

  it("accumulates assistant text deltas", () => {
    const store = new LLMHistory();
    store.startTurn("task");
    store.appendAssistantText("hello");
    store.appendAssistantText(" world");

    expect(store.getTurns()[0].assistantText).toBe("hello world");
  });

  it("throws when process mutations happen without a turn", () => {
    const store = new LLMHistory();

    expect(() => store.appendThinking("x")).toThrow("No active LLM turn");
    expect(() => store.startToolCall("t1", "read", {})).toThrow(
      "No active LLM turn",
    );
    expect(() => store.completeToolCall("t1", "result")).toThrow(
      "No active LLM turn",
    );
    expect(() => store.appendAssistantText("x")).toThrow("No active LLM turn");
  });

  it("replaces turns after validation", () => {
    const store = new LLMHistory();
    const turns: LLMTurn[] = [
      {
        userText: "task",
        process: [{ type: "tool_call", id: "t1", name: "read", input: {} }],
      },
    ];

    store.replaceTurns(turns);
    expect(store.getTurns()).toEqual(turns);
  });

  it("rejects invalid replacement turns", () => {
    const store = new LLMHistory();

    expect(() =>
      store.replaceTurns([
        {
          userText: "task",
          process: [
            { type: "tool_call", id: "t1", name: "read", input: {} },
            { type: "tool_call", id: "t1", name: "read", input: {} },
          ],
        },
      ]),
    ).toThrow("Duplicate tool call id");
  });

  it("removes the last turn when the predicate matches", () => {
    const store = new LLMHistory();
    store.startTurn("keep");
    store.startTurn("remove");

    expect(store.removeLastTurn((turn) => turn.userText === "remove")).toBe(
      true,
    );
    expect(store.getTurns()).toEqual([{ userText: "keep", process: [] }]);
  });
});
