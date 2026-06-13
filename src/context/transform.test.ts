import { describe, it, expect } from "vitest";
import type { MessageParam, StatusMessage } from "./index.js";
import { toDisplayMessages } from "./index.js";

describe("toDisplayMessages", () => {
  it("converts context blocks and attaches tool results", () => {
    const turns: MessageParam[] = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "text", text: "hi" },
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { path: "a" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "content" },
        ],
      },
    ];

    expect(toDisplayMessages(turns, [])).toEqual([
      { role: "user", content: "hello" },
      { role: "thinking", content: "plan" },
      { role: "text", content: "hi" },
      {
        role: "tool",
        name: "Read",
        input: { path: "a" },
        output: "content",
        slotId: "tool-1",
      },
    ]);
  });

  it("interleaves statuses by message index and applies display overrides", () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    const turns: MessageParam[] = [{ role: "user", content: "internal" }];
    const statuses: StatusMessage[] = [
      { role: "status", content: "before", timestamp, messageIndex: 0 },
      { role: "error", content: "after", timestamp, messageIndex: 1 },
    ];

    expect(
      toDisplayMessages(turns, statuses, new Map([[0, "display"]])),
    ).toEqual([
      { role: "status", content: "before", timestamp },
      { role: "user", content: "display" },
      { role: "error", content: "after", timestamp },
    ]);
  });
});
