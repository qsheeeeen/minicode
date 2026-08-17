import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Message } from "./Message.js";

describe("Message Component", () => {
  it("renders user message", () => {
    const { lastFrame } = render(
      <Message msg={{ role: "user", content: "hello" }} />,
    );
    expect(lastFrame()).toContain("hello");
  });

  it("renders text message", () => {
    const { lastFrame } = render(
      <Message msg={{ role: "text", content: "response text" }} />,
    );
    expect(lastFrame()).toContain("response text");
  });

  it("renders streaming text without trimming", () => {
    const { lastFrame } = render(
      <Message msg={{ role: "text", content: "streaming..." }} />,
    );
    expect(lastFrame()).toContain("streaming...");
  });

  it("renders thinking message", () => {
    const { lastFrame } = render(
      <Message msg={{ role: "thinking", content: "reasoning" }} />,
    );
    expect(lastFrame()).toContain("Thinking");
    expect(lastFrame()).toContain("reasoning");
  });

  it("renders tool message", () => {
    const { lastFrame } = render(
      <Message
        msg={{
          role: "tool",
          name: "Shell",
          input: { command: "ls" },
          output: "file1",
          slotId: "t1",
        }}
      />,
    );
    expect(lastFrame()).toContain("Shell(ls)");
  });

  it("renders status message", () => {
    const { lastFrame } = render(
      <Message msg={{ role: "status", content: "loading..." }} />,
    );
    expect(lastFrame()).toContain("loading...");
  });

  it("renders error message", () => {
    const { lastFrame } = render(
      <Message
        msg={{
          role: "error",
          content: "something failed",
        }}
      />,
    );
    expect(lastFrame()).toContain("something failed");
  });
});
