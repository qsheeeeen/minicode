import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputArea } from "./InputArea.js";
import { useTuiState, initialState } from "./state.js";
import { CommandRegistry } from "../commands/registry.js";
import { createDefaultSkillRegistry } from "../../skills/index.js";

const commandRegistry = new CommandRegistry();
const skillRegistry = createDefaultSkillRegistry();

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
        commandRegistry={commandRegistry}
        skillRegistry={skillRegistry}
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
        commandRegistry={commandRegistry}
        skillRegistry={skillRegistry}
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
        commandRegistry={commandRegistry}
        skillRegistry={skillRegistry}
      />,
    );

    const output = lastFrame();
    expect(output).toContain("Type a message or /command...");
    expect(output).toContain(">");
  });

  describe("steering while loading", () => {
    const fullProps = (overrides: {
      onSteer?: (t: string) => void;
      loadingRef?: React.MutableRefObject<boolean>;
      reportStatus?: (s: unknown) => void;
    }) => ({
      model: { getName: () => "m" } as any,
      handleSubmit: vi.fn(async () => true),
      onSteer: overrides.onSteer ?? vi.fn(),
      loadingRef: overrides.loadingRef ?? mockLoadingRef(true),
      config: {} as any,
      modelSwitchService: {} as any,
      sessionManager: {
        reportStatus: overrides.reportStatus ?? vi.fn(),
      } as any,
      commandRegistry,
      skillRegistry,
    });

    it("queues plain text via onSteer and clears the input", async () => {
      const onSteer = vi.fn();
      const { stdin } = render(
        <InputArea {...fullProps({ onSteer })} />,
      );

      stdin.write("also check the tests");
      await new Promise((r) => setTimeout(r, 30));
      stdin.write("\r");
      await new Promise((r) => setTimeout(r, 30));

      expect(onSteer).toHaveBeenCalledWith("also check the tests");
      expect(useTuiState.getState().input.value).toBe("");
    });

    it("blocks commands and shell lines while loading, keeping the text", async () => {
      const onSteer = vi.fn();
      const reportStatus = vi.fn();
      const { stdin } = render(
        <InputArea {...fullProps({ onSteer, reportStatus })} />,
      );

      stdin.write("/model");
      await new Promise((r) => setTimeout(r, 30));
      stdin.write("\r");
      await new Promise((r) => setTimeout(r, 30));

      expect(onSteer).not.toHaveBeenCalled();
      expect(reportStatus).toHaveBeenCalled();
      expect(useTuiState.getState().input.value).toBe("/model");
    });

    it("shows queued messages below the input", () => {
      useTuiState.setState({ steeringQueue: ["first", "second"] });

      const { lastFrame } = render(
        <InputArea {...fullProps({ loadingRef: mockLoadingRef(true) })} />,
      );

      expect(lastFrame()).toContain("⇢ queued: first");
      expect(lastFrame()).toContain("⇢ queued: second");
    });
  });
});
