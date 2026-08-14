import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { ToolDisplay } from "./tool-display.js";

describe("ToolDisplay", () => {
  it("renders call only when no output", () => {
    const { lastFrame } = render(
      <ToolDisplay name="Shell" input={{ command: "ls" }} />,
    );
    expect(lastFrame()).toContain("Shell(ls)");
  });

  it("renders call and output for Shell", () => {
    const { lastFrame } = render(
      <ToolDisplay
        name="Shell"
        input={{ command: "ls" }}
        output="file1\nfile2"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Shell(ls)");
    expect(frame).toContain("file1");
  });

  it("renders Read output as line/char summary", () => {
    const { lastFrame } = render(
      <ToolDisplay
        name="Read"
        input={{ path: "f.ts" }}
        output="line1\nline2"
      />,
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

  it("renders Python call with full code (no truncation)", () => {
    const longCode =
      "total = 0\nfor i in range(1, 100):\n    total += i\nprint(total)";
    const { lastFrame } = render(
      <ToolDisplay name="Python" input={{ code: longCode, path: "src" }} />,
    );
    const frame = lastFrame();
    expect(frame).toContain(longCode);
    expect(frame).not.toContain("...");
  });

  it("renders Python output in full (no truncation)", () => {
    const longOutput = Array.from({ length: 30 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const { lastFrame } = render(
      <ToolDisplay
        name="Python"
        input={{ code: "print('hi')" }}
        output={longOutput}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("line 0");
    expect(frame).toContain("line 29");
  });
});
