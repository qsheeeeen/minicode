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
      <Message
        msg={{ role: "text", content: "streaming...", isStreaming: true }}
      />,
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
          name: "Bash",
          input: { command: "ls" },
          output: "file1",
        }}
      />,
    );
    expect(lastFrame()).toContain("Bash(ls)");
  });

  it("renders status message", () => {
    const { lastFrame } = render(
      <Message
        msg={{ role: "status", content: "loading...", timestamp: new Date() }}
      />,
    );
    expect(lastFrame()).toContain("loading...");
  });

  it("renders error message", () => {
    const { lastFrame } = render(
      <Message
        msg={{
          role: "error",
          content: "something failed",
          timestamp: new Date(),
        }}
      />,
    );
    expect(lastFrame()).toContain("something failed");
  });

  it("renders status with toolDisplay", () => {
    const { lastFrame } = render(
      <Message
        msg={{
          role: "status",
          content: "",
          timestamp: new Date(),
          toolDisplay: {
            name: "Read",
            input: { path: "f.ts" },
            output: "content",
          },
        }}
      />,
    );
    expect(lastFrame()).toContain("Read(f.ts)");
  });

  it("returns null for unknown role", () => {
    const { lastFrame } = render(<Message msg={{ role: "unknown" } as any} />);
    expect(lastFrame()).toBe("");
  });
});
