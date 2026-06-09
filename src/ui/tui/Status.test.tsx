import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach } from "vitest";
import { Status } from "./Status.js";
import { useTuiStore, initialState } from "./store.js";

describe("Status Component", () => {
  beforeEach(() => {
    useTuiStore.setState(initialState, true);
  });

  it("renders nothing when not loading", () => {
    useTuiStore.setState({ isLoading: false });
    const { lastFrame } = render(<Status />);
    expect(lastFrame()).toBe("");
  });

  it("shows 'Thinking...' when loading without pending prompt", () => {
    useTuiStore.setState({ isLoading: true, pendingPrompt: null });
    const { lastFrame } = render(<Status />);
    expect(lastFrame()).toContain("Thinking...");
  });

  it("shows 'Waiting for user...' when loading with pending prompt", () => {
    useTuiStore.setState({
      isLoading: true,
      pendingPrompt: {
        type: "text",
        message: "confirm?",
        resolve: () => {},
      } as any,
    });
    const { lastFrame } = render(<Status />);
    expect(lastFrame()).toContain("Waiting for user...");
  });
});
