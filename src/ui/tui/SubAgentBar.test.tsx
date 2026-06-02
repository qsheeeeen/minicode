import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { SubAgentBar } from "./SubAgentBar.js";
import { TuiProvider } from "./store.js";

describe("SubAgentBar Component", () => {
  it("renders nothing with single session", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            { id: "1", type: "main", agent: {} as any, status: "idle" },
          ],
        }}
      >
        <SubAgentBar />
      </TuiProvider>,
    );
    expect(lastFrame()).toBe("");
  });

  it("renders multiple sessions", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            {
              id: "1",
              type: "main",
              agent: {} as any,
              status: "idle",
              task: "Main agent",
            },
            {
              id: "2",
              type: "sub",
              agent: {} as any,
              status: "running",
              task: "Do something",
            },
          ],
        }}
      >
        <SubAgentBar />
      </TuiProvider>,
    );
    const output = lastFrame();
    expect(output).toContain("[1]");
    expect(output).toContain("[2]");
    expect(output).toContain("Main agent");
    expect(output).toContain("Do something");
  });

  it("shows status icons for different statuses", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            { id: "1", type: "main", agent: {} as any, status: "running" },
            { id: "2", type: "sub", agent: {} as any, status: "completed" },
            { id: "3", type: "sub", agent: {} as any, status: "error" },
            { id: "4", type: "sub", agent: {} as any, status: "idle" },
          ],
        }}
      >
        <SubAgentBar />
      </TuiProvider>,
    );
    const output = lastFrame();
    expect(output).toContain("⟳"); // running
    expect(output).toContain("✓"); // completed
    expect(output).toContain("✕"); // error
    expect(output).toContain("●"); // idle
  });

  it("shows token and tool stats when available", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            {
              id: "1",
              type: "main",
              agent: {} as any,
              status: "idle",
              tokenCount: 1500,
              toolCalls: 5,
            },
            { id: "2", type: "sub", agent: {} as any, status: "idle" },
          ],
        }}
      >
        <SubAgentBar />
      </TuiProvider>,
    );
    const output = lastFrame();
    expect(output).toContain("1,500 tok");
    expect(output).toContain("5 tools");
  });

  it("truncates long task names", () => {
    const longTask = "a".repeat(60);
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            { id: "1", type: "main", agent: {} as any, status: "idle" },
            {
              id: "2",
              type: "sub",
              agent: {} as any,
              status: "idle",
              task: longTask,
            },
          ],
        }}
      >
        <SubAgentBar />
      </TuiProvider>,
    );
    expect(lastFrame()).toContain("...");
  });
});
