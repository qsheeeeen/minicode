import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { Header } from "./Header.js";
import { TuiProvider } from "./store.js";

describe("Header Component", () => {
  it("renders version and prompt files correctly", () => {
    const mockAgentRef = {
      current: {
        getModelProvider: () => "test-provider",
        getModelName: () => "test-model",
      },
    } as any;

    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "1",
          agentSessions: [
            {
              id: "1",
              type: "main",
              agent: mockAgentRef.current,
              status: "idle",
            },
          ],
        }}
      >
        <Header version="1.2.3" promptFiles={["prompt1.md", "prompt2.md"]} />
      </TuiProvider>,
    );

    const output = lastFrame();
    expect(output).toContain("Mini Code");
    expect(output).toContain("v1.2.3");
    expect(output).toContain("prompt1.md, prompt2.md");
  });

  it("shows multi-agent indicator if multiple sessions exist", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          activeAgentId: "2",
          agentSessions: [
            { id: "1", type: "main", agent: {} as any, status: "idle" },
            { id: "2", type: "sub", agent: {} as any, status: "idle" },
          ],
        }}
      >
        <Header version="1.0.0" promptFiles={[]} />
      </TuiProvider>,
    );

    const output = lastFrame();
    expect(output).toContain("[2]");
  });
});
