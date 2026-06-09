import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModalPrompter } from "./ModalPrompter.js";
import { useTuiStore, initialState } from "./store.js";

describe("ModalPrompter Component", () => {
  beforeEach(() => {
    useTuiStore.setState(initialState, true);
  });

  it("returns null if there is no pending prompt", () => {
    useTuiStore.setState({ pendingPrompt: null });
    const { lastFrame } = render(<ModalPrompter />);
    expect(lastFrame()).toBe("");
  });

  it("renders a pending prompt correctly", () => {
    const mockResolve = vi.fn();
    useTuiStore.setState({
      pendingPrompt: {
        message: "Please choose:",
        type: "choice",
        options: [{ label: "Option A", value: "a", description: "Desc A" }],
        resolve: mockResolve,
      },
    });

    const { lastFrame } = render(<ModalPrompter />);

    const output = lastFrame();
    expect(output).toContain("Please choose:");
    expect(output).toContain("Option A");
    expect(output).toContain("Desc A");
  });
});
