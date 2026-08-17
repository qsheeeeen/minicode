import { describe, it, expect } from "vitest";
import type { LLMBlock } from "../core/blocks.js";
import type { StatusMessage } from "./display.js";
import { toDisplayMessages } from "./display.js";

describe("toDisplayMessages", () => {
  it("converts context blocks and attaches tool results", () => {
    const blocks: LLMBlock[] = [
      { type: "user", text: "hello" },
      { type: "thinking", thinking: "plan" },
      {
        type: "tool_use",
        id: "tool-1",
        name: "Read",
        input: { path: "a" },
      },
      { type: "tool_result", tool_use_id: "tool-1", content: "content" },
      { type: "text", text: "hi" },
    ];

    expect(toDisplayMessages(blocks, [])).toEqual([
      { role: "user", content: "hello" },
      { role: "thinking", content: "plan" },
      {
        role: "tool",
        name: "Read",
        input: { path: "a" },
        output: "content",
        slotId: "tool-1",
      },
      { role: "text", content: "hi" },
    ]);
  });

  it("interleaves statuses by user message index", () => {
    const blocks: LLMBlock[] = [{ type: "user", text: "internal" }];
    const statuses: StatusMessage[] = [
      { role: "status", content: "before", userMessageIndex: 0 },
      { role: "error", content: "after", userMessageIndex: 1 },
    ];

    expect(toDisplayMessages(blocks, statuses)).toEqual([
      { role: "status", content: "before" },
      { role: "user", content: "internal" },
      { role: "error", content: "after" },
    ]);
  });

  it("projects a status carrying toolDisplay into a tool message", () => {
    const blocks: LLMBlock[] = [{ type: "user", text: "run it" }];
    const statuses: StatusMessage[] = [
      {
        role: "status",
        content: "",
        toolDisplay: { name: "Shell", input: { command: "ls" }, output: "a b" },
      },
    ];

    expect(toDisplayMessages(blocks, statuses)).toEqual([
      { role: "user", content: "run it" },
      {
        role: "tool",
        name: "Shell",
        input: { command: "ls" },
        output: "a b",
        slotId: "status-0",
      },
    ]);
  });
});
