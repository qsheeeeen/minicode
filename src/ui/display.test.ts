import { describe, it, expect } from "vitest";
import type { LLMTurn } from "../llm/history.js";
import type { StatusMessage } from "./display.js";
import { toDisplayMessages } from "./display.js";

describe("toDisplayMessages", () => {
  it("converts context blocks and attaches tool results", () => {
    const turns: LLMTurn[] = [
      {
        userText: "hello",
        process: [
          { type: "thinking", thinking: "plan" },
          {
            type: "tool_call",
            id: "tool-1",
            name: "Read",
            input: { path: "a" },
            result: "content",
          },
        ],
        assistantText: "hi",
      },
    ];

    expect(toDisplayMessages(turns, [])).toEqual([
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

  it("interleaves statuses by turn index", () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    const turns: LLMTurn[] = [{ userText: "internal", process: [] }];
    const statuses: StatusMessage[] = [
      { role: "status", content: "before", timestamp, turnIndex: 0 },
      { role: "error", content: "after", timestamp, turnIndex: 1 },
    ];

    expect(toDisplayMessages(turns, statuses)).toEqual([
      { role: "status", content: "before", timestamp },
      { role: "user", content: "internal" },
      { role: "error", content: "after", timestamp },
    ]);
  });
});
