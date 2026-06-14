import { describe, it, expect, vi } from "vitest";
import { LLMHistory } from "./history-store.js";
import type { LLMBlock } from "./history.js";

describe("LLMHistory", () => {
  it("notifies subscribers on mutations and returns unsubscribe", () => {
    const store = new LLMHistory();
    const listener = vi.fn();
    const unsub = store.onChange(listener);

    store.startUserMessage("hello");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.startUserMessage("world");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stores blocks and returns defensive copies", () => {
    const store = new LLMHistory();
    store.startUserMessage("hello");

    const blocks = store.getBlocks();
    expect(blocks).toEqual([{ type: "user", text: "hello" }]);

    blocks.push({ type: "user", text: "injected" });
    expect(store.getBlocks()).toHaveLength(1);
  });

  it("counts and lists user messages", () => {
    const store = new LLMHistory();
    const blocks: LLMBlock[] = [
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
    ];
    store.replaceBlocks(blocks);

    expect(store.getUserMessageCount()).toBe(2);
    expect(store.getUserMessages()).toEqual(["one", "two"]);
  });

  it("accumulates consecutive thinking deltas into one block", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.appendThinking("plan");
    store.appendThinking(" more");

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "thinking", thinking: "plan more" },
    ]);
  });

  it("creates a new thinking block after a tool call", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.appendThinking("first");
    store.startToolCall("t1", "read", { path: "a.ts" });
    store.appendThinking("second");

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "thinking", thinking: "first" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "thinking", thinking: "second" },
    ]);
  });

  it("starts and completes tool calls", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.startToolCall("t1", "read", { path: "a.ts" });
    store.completeToolCall("t1", "content");

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "tool_result", tool_use_id: "t1", content: "content" },
    ]);
  });

  it("overwrites repeated tool results", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.startToolCall("t1", "read", {});
    store.completeToolCall("t1", "one");
    store.completeToolCall("t1", "two");

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
      { type: "tool_result", tool_use_id: "t1", content: "two" },
    ]);
  });

  it("rejects duplicate tool use ids in the current user message", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.startToolCall("t1", "read", {});

    expect(() => store.startToolCall("t1", "read", {})).toThrow(
      "Duplicate tool use id",
    );
  });

  it("throws when completing a missing tool use", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");

    expect(() => store.completeToolCall("missing", "result")).toThrow(
      "Tool use not found",
    );
  });

  it("accumulates assistant text deltas", () => {
    const store = new LLMHistory();
    store.startUserMessage("task");
    store.appendAssistantText("hello");
    store.appendAssistantText(" world");

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "text", text: "hello world" },
    ]);
  });

  it("throws when process mutations happen without a user message", () => {
    const store = new LLMHistory();

    expect(() => store.appendThinking("x")).toThrow("No active user message");
    expect(() => store.startToolCall("t1", "read", {})).toThrow(
      "No active user message",
    );
    expect(() => store.completeToolCall("t1", "result")).toThrow(
      "No active user message",
    );
    expect(() => store.appendAssistantText("x")).toThrow(
      "No active user message",
    );
  });

  it("replaces blocks after validation", () => {
    const store = new LLMHistory();
    const blocks: LLMBlock[] = [
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
    ];

    store.replaceBlocks(blocks);
    expect(store.getBlocks()).toEqual(blocks);
  });

  it("rejects invalid replacement blocks", () => {
    const store = new LLMHistory();

    expect(() =>
      store.replaceBlocks([
        { type: "user", text: "task" },
        { type: "tool_use", id: "t1", name: "read", input: {} },
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ]),
    ).toThrow("Duplicate tool use id");
  });

  it("removes blocks from the last user message when the predicate matches", () => {
    const store = new LLMHistory();
    store.startUserMessage("keep");
    store.startUserMessage("remove");

    expect(
      store.removeFromLastUserMessage(
        (blocks) => blocks[0]?.type === "user" && blocks[0].text === "remove",
      ),
    ).toBe(true);
    expect(store.getBlocks()).toEqual([{ type: "user", text: "keep" }]);
  });

  it("truncates before a user message ordinal", () => {
    const store = new LLMHistory();
    store.replaceBlocks([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
    ]);

    store.truncateBeforeUserMessageOrdinal(2);

    expect(store.getBlocks()).toEqual([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
    ]);
  });

  it("splits at recent user messages", () => {
    const store = new LLMHistory();
    store.replaceBlocks([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
      { type: "user", text: "three" },
    ]);

    expect(store.splitAtRecentUserMessages(2)).toEqual({
      prefix: [
        { type: "user", text: "one" },
        { type: "text", text: "reply" },
      ],
      suffix: [
        { type: "user", text: "two" },
        { type: "user", text: "three" },
      ],
    });
  });
});
