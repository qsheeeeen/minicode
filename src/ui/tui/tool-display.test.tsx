import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { callContent, ToolDisplay } from "./tool-display.js";

describe("callContent", () => {
  it("formats Read with path only", () => {
    expect(callContent("Read", { path: "src/index.ts" })).toBe(
      "Read(src/index.ts)",
    );
  });

  it("formats Read with offset and limit", () => {
    expect(
      callContent("Read", { path: "src/index.ts", offset: 10, limit: 50 }),
    ).toBe("Read(src/index.ts, offset: 10, limit: 50)");
  });

  it("formats Write with line count", () => {
    expect(
      callContent("Write", { path: "out.txt", content: "line1\nline2\nline3" }),
    ).toBe("Write(out.txt, 3 lines)");
  });

  it("formats Write with empty content", () => {
    expect(callContent("Write", { path: "out.txt", content: "" })).toBe(
      "Write(out.txt, 0 lines)",
    );
  });

  it("formats Edit with path", () => {
    expect(callContent("Edit", { path: "src/app.ts" })).toBe("Edit(src/app.ts)");
  });

  it("formats Bash with command", () => {
    expect(callContent("Bash", { command: "npm test" })).toBe(
      "Bash(npm test)",
    );
  });

  it("formats SubAgent with short task", () => {
    expect(callContent("SubAgent", { task: "do something" })).toBe(
      "SubAgent(do something)",
    );
  });

  it("formats SubAgent with long task (truncated)", () => {
    const longTask = "a".repeat(50);
    expect(callContent("SubAgent", { task: longTask })).toBe(
      `SubAgent(${"a".repeat(30)}...)`,
    );
  });

  it("formats ActivateSkill with name", () => {
    expect(callContent("ActivateSkill", { name: "tdd" })).toBe(
      "ActivateSkill(tdd)",
    );
  });

  it("formats AskUser with question", () => {
    expect(callContent("AskUser", { question: "really?" })).toBe(
      'AskUser("really?")',
    );
  });

  it("formats SetModel with tier", () => {
    expect(callContent("SetModel", { tier: "flash" })).toBe("SetModel(Flash)");
  });

  it("formats SetModel with pro tier", () => {
    expect(callContent("SetModel", { tier: "pro" })).toBe("SetModel(Pro)");
  });

  it("formats unknown tool with JSON summary", () => {
    const result = callContent("Unknown", { foo: "bar" });
    expect(result).toBe('Unknown({"foo":"bar"})');
  });
});

describe("ToolDisplay", () => {
  it("renders call only when no output", () => {
    const { lastFrame } = render(
      <ToolDisplay name="Bash" input={{ command: "ls" }} />,
    );
    expect(lastFrame()).toContain("Bash(ls)");
  });

  it("renders call and output for Bash", () => {
    const { lastFrame } = render(
      <ToolDisplay name="Bash" input={{ command: "ls" }} output="file1\nfile2" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Bash(ls)");
    expect(frame).toContain("file1");
  });

  it("renders Read output as line/char summary", () => {
    const { lastFrame } = render(
      <ToolDisplay name="Read" input={{ path: "f.ts" }} output="line1\nline2" />,
    );
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("lines");
    expect(lastFrame()).toContain("chars");
  });

  it("renders diff for Edit tool", () => {
    const diffOutput = "--- a/f.ts\n+++ b/f.ts\n  1 -old\n  2 +new";
    const { lastFrame } = render(
      <ToolDisplay name="Edit" input={{ path: "f.ts" }} output={diffOutput} />,
    );
    expect(lastFrame()).toContain("Edit(f.ts)");
  });
});
