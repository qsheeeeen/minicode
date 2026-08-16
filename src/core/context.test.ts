import { describe, it, expect, vi } from "vitest";
import { LLMContext } from "./context.js";
import type { LLMBlock } from "./context.js";

describe("LLMContext", () => {
  it("notifies subscribers on mutations and returns unsubscribe", () => {
    const context = new LLMContext();
    const listener = vi.fn();
    const unsub = context.onChange(listener);

    context.startUserMessage("hello");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    context.startUserMessage("world");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stores blocks and returns defensive copies", () => {
    const context = new LLMContext();
    context.startUserMessage("hello");

    const blocks = context.getBlocks();
    expect(blocks).toEqual([{ type: "user", text: "hello" }]);

    blocks.push({ type: "user", text: "injected" });
    expect(context.getBlocks()).toHaveLength(1);
  });

  it("counts and lists user messages", () => {
    const context = new LLMContext();
    const blocks: LLMBlock[] = [
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
    ];
    context.replaceBlocks(blocks);

    expect(context.getUserMessageCount()).toBe(2);
    expect(context.getUserMessages()).toEqual(["one", "two"]);
  });

  it("accumulates consecutive thinking deltas into one block", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.appendThinking("plan");
    context.appendThinking(" more");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "thinking", thinking: "plan more" },
    ]);
  });

  it("creates a new thinking block after a tool call", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.appendThinking("first");
    context.startToolCall("t1", "read", { path: "a.ts" });
    context.appendThinking("second");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "thinking", thinking: "first" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "thinking", thinking: "second" },
    ]);
  });

  it("starts and completes tool calls", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.startToolCall("t1", "read", { path: "a.ts" });
    context.completeToolCall("t1", "content");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "tool_result", tool_use_id: "t1", content: "content" },
    ]);
  });

  it("overwrites repeated tool results", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.startToolCall("t1", "read", {});
    context.completeToolCall("t1", "one");
    context.completeToolCall("t1", "two");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
      { type: "tool_result", tool_use_id: "t1", content: "two" },
    ]);
  });

  it("rejects duplicate tool use ids in the current user message", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.startToolCall("t1", "read", {});

    expect(() => context.startToolCall("t1", "read", {})).toThrow(
      "Duplicate tool use id",
    );
  });

  it("throws when completing a missing tool use", () => {
    const context = new LLMContext();
    context.startUserMessage("task");

    expect(() => context.completeToolCall("missing", "result")).toThrow(
      "Tool use not found",
    );
  });

  it("accumulates assistant text deltas", () => {
    const context = new LLMContext();
    context.startUserMessage("task");
    context.appendAssistantText("hello");
    context.appendAssistantText(" world");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task" },
      { type: "text", text: "hello world" },
    ]);
  });

  it("throws when process mutations happen without a user message", () => {
    const context = new LLMContext();

    expect(() => context.appendThinking("x")).toThrow("No active user message");
    expect(() => context.startToolCall("t1", "read", {})).toThrow(
      "No active user message",
    );
    expect(() => context.completeToolCall("t1", "result")).toThrow(
      "No active user message",
    );
    expect(() => context.appendAssistantText("x")).toThrow(
      "No active user message",
    );
  });

  it("replaces blocks after validation", () => {
    const context = new LLMContext();
    const blocks: LLMBlock[] = [
      { type: "user", text: "task" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
    ];

    context.replaceBlocks(blocks);
    expect(context.getBlocks()).toEqual(blocks);
  });

  it("rejects invalid replacement blocks", () => {
    const context = new LLMContext();

    expect(() =>
      context.replaceBlocks([
        { type: "user", text: "task" },
        { type: "tool_use", id: "t1", name: "read", input: {} },
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ]),
    ).toThrow("Duplicate tool use id");
  });

  it("truncates before a user message ordinal", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
    ]);

    context.truncateBeforeUserMessageOrdinal(2);

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
    ]);
  });

  it("splits at recent user messages", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one" },
      { type: "text", text: "reply" },
      { type: "user", text: "two" },
      { type: "user", text: "three" },
    ]);

    expect(context.splitAtRecentUserMessages(2)).toEqual({
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
