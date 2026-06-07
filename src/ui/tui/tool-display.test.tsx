import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { ToolDisplay } from "./tool-display.js";

describe("ToolDisplay", () => {
  it("renders call only when no output", () => {
    const { lastFrame } = render(
      <ToolDisplay name="Bash" input={{ command: "ls" }} />,
    );
    expect(lastFrame()).toContain("Bash(ls)");
  });

  it("renders call and output for Bash", () => {
    const { lastFrame } = render(
      <ToolDisplay
        name="Bash"
        input={{ command: "ls" }}
        output="file1\nfile2"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Bash(ls)");
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
});
