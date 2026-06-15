import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputArea } from "./InputArea.js";
import { useTuiState, initialState } from "./state.js";

describe("InputArea Component", () => {
  const mockLoadingRef = (
    loading: boolean,
  ): React.MutableRefObject<boolean> => {
    const ref = createRef() as React.MutableRefObject<boolean>;
    (ref as any).current = loading;
    return ref;
  };

  beforeEach(() => {
    useTuiState.setState(initialState, true);
  });

  it("renders nothing when there is a pending prompt (isModal = true)", () => {
    const mockAgentRef = { current: {} } as any;

    useTuiState.setState({
      pendingPrompt: {
        message: "hi",
        type: "text",
        options: [],
        resolve: vi.fn(),
      },
      input: { mode: "chat", value: "", props: {}, key: 0 },
    });

    const { lastFrame } = render(
      <InputArea
        agentRef={mockAgentRef}
        handleSubmit={vi.fn()}
        loadingRef={mockLoadingRef(false)}
      />,
    );

    expect(lastFrame()).toBe("");
  });

  it("renders chat input by default", () => {
    const mockAgentRef = {
      current: { getStore: () => ({ addStatus: vi.fn() }) },
    } as any;

    useTuiState.setState({
      pendingPrompt: null,
      input: { mode: "chat", value: "", props: {}, key: 0 },
    });

    const { lastFrame } = render(
      <InputArea
        agentRef={mockAgentRef}
        handleSubmit={vi.fn()}
        loadingRef={mockLoadingRef(false)}
      />,
    );

    const output = lastFrame();
    expect(output).toContain("Type a message or /command...");
    expect(output).toContain(">");
  });

  it("still renders input when isLoading is true", () => {
    const mockAgentRef = {
      current: { getStore: () => ({ addStatus: vi.fn() }) },
    } as any;

    useTuiState.setState({
      pendingPrompt: null,
      input: { mode: "chat", value: "", props: {}, key: 0 },
      isLoading: true,
    });

    const { lastFrame } = render(
      <InputArea
        agentRef={mockAgentRef}
        handleSubmit={vi.fn()}
        loadingRef={mockLoadingRef(true)}
      />,
    );

    const output = lastFrame();
    expect(output).toContain("Type a message or /command...");
    expect(output).toContain(">");
  });
});
