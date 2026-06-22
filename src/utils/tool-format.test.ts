import { describe, it, expect } from "vitest";
import { callContent } from "./tool-format.js";

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
    expect(callContent("Edit", { path: "src/app.ts" })).toBe(
      "Edit(src/app.ts)",
    );
  });

  it("formats Shell with command", () => {
    expect(callContent("Shell", { command: "npm test" })).toBe("Shell(npm test)");
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

  it("formats LoadSkill with name", () => {
    expect(callContent("LoadSkill", { name: "tdd" })).toBe(
      "LoadSkill(tdd)",
    );
  });

  it("formats AskUser with question", () => {
    expect(callContent("AskUser", { question: "really?" })).toBe(
      'AskUser("really?")',
    );
  });

  it("throws for a tool with no formatter implemented", () => {
    expect(() => callContent("Unknown", { foo: "bar" })).toThrow(
      /no formatter implemented/,
    );
  });
});
