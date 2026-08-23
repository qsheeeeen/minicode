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
    context.startUserMessage("hello", "u1");

    const blocks = context.getBlocks();
    expect(blocks).toEqual([{ type: "user", text: "hello", id: "u1" }]);

    blocks.push({ type: "user", text: "injected" });
    expect(context.getBlocks()).toHaveLength(1);
  });

  it("assigns stable ids to user messages and accepts explicit ones", () => {
    const context = new LLMContext();
    const auto = context.startUserMessage("one");
    expect(typeof auto).toBe("string");
    expect(auto.length).toBeGreaterThan(0);

    const explicit = context.startUserMessage("two", "fixed-id");
    expect(explicit).toBe("fixed-id");
    expect(context.getBlocks()[1]).toEqual({
      type: "user",
      text: "two",
      id: "fixed-id",
    });
  });

  it("counts and lists user messages", () => {
    const context = new LLMContext();
    const blocks: LLMBlock[] = [
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "reply" },
      { type: "user", text: "two", id: "u2" },
    ];
    context.replaceBlocks(blocks);

    expect(context.getUserMessageCount()).toBe(2);
    expect(context.getUserMessages()).toEqual(["one", "two"]);
  });

  it("summarizes user messages with ids and ordinals", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "reply" },
      { type: "user", text: "two", id: "u2" },
    ]);

    expect(context.getUserMessageSummaries()).toEqual([
      { id: "u1", ordinal: 1, text: "one" },
      { id: "u2", ordinal: 2, text: "two" },
    ]);
  });

  it("assigns fresh ids to legacy blocks on replaceBlocks", () => {
    const context = new LLMContext();
    context.replaceBlocks([{ type: "user", text: "legacy" }]);
    const first = context.getBlocksReadonly()[0] as { id?: string };
    expect(typeof first.id).toBe("string");

    context.replaceBlocks([{ type: "user", text: "legacy" }]);
    const second = context.getBlocksReadonly()[0] as { id?: string };
    expect(second.id).not.toBe(first.id);
  });

  it("rejects duplicate user message ids", () => {
    const context = new LLMContext();

    expect(() =>
      context.replaceBlocks([
        { type: "user", text: "one", id: "same" },
        { type: "user", text: "two", id: "same" },
      ]),
    ).toThrow("Duplicate user message id");
  });

  it("accumulates consecutive thinking deltas into one block", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.appendThinking("plan");
    context.appendThinking(" more");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task", id: "u1" },
      { type: "thinking", thinking: "plan more" },
    ]);
  });

  it("creates a new thinking block after a tool call", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.appendThinking("first");
    context.startToolCall("t1", "read", { path: "a.ts" });
    context.appendThinking("second");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task", id: "u1" },
      { type: "thinking", thinking: "first" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "thinking", thinking: "second" },
    ]);
  });

  it("starts and completes tool calls", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.startToolCall("t1", "read", { path: "a.ts" });
    context.completeToolCall("t1", "content");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task", id: "u1" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.ts" } },
      { type: "tool_result", tool_use_id: "t1", content: "content" },
    ]);
  });

  it("overwrites repeated tool results", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.startToolCall("t1", "read", {});
    context.completeToolCall("t1", "one");
    context.completeToolCall("t1", "two");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task", id: "u1" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
      { type: "tool_result", tool_use_id: "t1", content: "two" },
    ]);
  });

  it("stores images on completed tool calls", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.startToolCall("t1", "Read", { path: "a.png" });
    context.completeToolCall("t1", "[image: a.png]", [
      { mediaType: "image/png", base64: "AAAA" },
    ]);

    expect(context.getBlocksReadonly()[2]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: "[image: a.png]",
      images: [{ mediaType: "image/png", base64: "AAAA" }],
    });
  });

  it("overwrites a tool result without images when none are given", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.startToolCall("t1", "Read", {});
    context.completeToolCall("t1", "one", [
      { mediaType: "image/png", base64: "AAAA" },
    ]);
    context.completeToolCall("t1", "two");

    expect(context.getBlocksReadonly()[2]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: "two",
    });
  });

  it("rejects invalid images on replacement", () => {
    const context = new LLMContext();

    expect(() =>
      context.replaceBlocks([
        {
          type: "user",
          text: "task",
        },
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: {},
        },
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "out",
          images: [{ mediaType: "image/bmp", base64: "AAAA" }],
        },
      ]),
    ).toThrow("Invalid tool result block: images");

    expect(() =>
      context.replaceBlocks([
        { type: "user", text: "task" },
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "out",
          images: [{ mediaType: "image/png", base64: "" }],
        },
      ]),
    ).toThrow("Invalid tool result block: images");
  });

  it("rejects duplicate tool use ids in the current user message", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.startToolCall("t1", "read", {});

    expect(() => context.startToolCall("t1", "read", {})).toThrow(
      "Duplicate tool use id",
    );
  });

  it("throws when completing a missing tool use", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");

    expect(() => context.completeToolCall("missing", "result")).toThrow(
      "Tool use not found",
    );
  });

  it("accumulates assistant text deltas", () => {
    const context = new LLMContext();
    context.startUserMessage("task", "u1");
    context.appendAssistantText("hello");
    context.appendAssistantText(" world");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "task", id: "u1" },
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
      { type: "user", text: "task", id: "u1" },
      { type: "tool_use", id: "t1", name: "read", input: {} },
    ];

    context.replaceBlocks(blocks);
    expect(context.getBlocks()).toEqual(blocks);
  });

  it("rejects invalid replacement blocks", () => {
    const context = new LLMContext();

    expect(() =>
      context.replaceBlocks([
        { type: "user", text: "task", id: "u1" },
        { type: "tool_use", id: "t1", name: "read", input: {} },
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ]),
    ).toThrow("Duplicate tool use id");
  });

  it("truncates before a user message by stable id", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "reply" },
      { type: "user", text: "two", id: "u2" },
    ]);

    context.truncateBeforeUserMessageId("u2");

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "reply" },
    ]);
  });

  it("truncating by an unknown id is a no-op", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one", id: "u1" },
      { type: "user", text: "two", id: "u2" },
    ]);

    context.truncateBeforeUserMessageId("missing");

    expect(context.getUserMessageCount()).toBe(2);
  });

  it("splits at recent user messages", () => {
    const context = new LLMContext();
    context.replaceBlocks([
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "reply" },
      { type: "user", text: "two", id: "u2" },
      { type: "user", text: "three", id: "u3" },
    ]);

    expect(context.splitAtRecentUserMessages(2)).toEqual({
      prefix: [
        { type: "user", text: "one", id: "u1" },
        { type: "text", text: "reply" },
      ],
      suffix: [
        { type: "user", text: "two", id: "u2" },
        { type: "user", text: "three", id: "u3" },
      ],
    });
  });
});
