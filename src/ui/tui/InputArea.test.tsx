import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { InputArea } from "./InputArea.js";
import { TuiProvider } from "./store.js";

describe("InputArea Component", () => {
  const mockLoadingRef = (
    loading: boolean,
  ): React.MutableRefObject<boolean> => {
    const ref = createRef() as React.MutableRefObject<boolean>;
    (ref as any).current = loading;
    return ref;
  };

  it("renders nothing when there is a pending prompt (isModal = true)", () => {
    const mockAgentRef = { current: {} } as any;

    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          pendingPrompt: {
            message: "hi",
            type: "text",
            options: [],
            resolve: vi.fn(),
          },
          input: { mode: "chat", value: "", props: {}, key: 0 },
        }}
      >
        <InputArea
          agentRef={mockAgentRef}
          handleSubmit={vi.fn()}
          loadingRef={mockLoadingRef(false)}
        />
      </TuiProvider>,
    );

    expect(lastFrame()).toBe("");
  });

  it("renders chat input by default", () => {
    const mockAgentRef = {
      current: { getStore: () => ({ addStatus: vi.fn() }) },
    } as any;

    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          pendingPrompt: null,
          input: { mode: "chat", value: "", props: {}, key: 0 },
        }}
      >
        <InputArea
          agentRef={mockAgentRef}
          handleSubmit={vi.fn()}
          loadingRef={mockLoadingRef(false)}
        />
      </TuiProvider>,
    );

    const output = lastFrame();
    expect(output).toContain("Type a message or /command...");
    expect(output).toContain(">");
  });

  it("still renders input when isLoading is true", () => {
    const mockAgentRef = {
      current: { getStore: () => ({ addStatus: vi.fn() }) },
    } as any;

    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          pendingPrompt: null,
          input: { mode: "chat", value: "", props: {}, key: 0 },
          isLoading: true,
        }}
      >
        <InputArea
          agentRef={mockAgentRef}
          handleSubmit={vi.fn()}
          loadingRef={mockLoadingRef(true)}
        />
      </TuiProvider>,
    );

    const output = lastFrame();
    expect(output).toContain("Type a message or /command...");
    expect(output).toContain(">");
  });
});
