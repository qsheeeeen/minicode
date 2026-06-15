import { describe, it, expect, beforeEach } from "vitest";
import { useTuiState, initialState } from "./state.js";

describe("useTuiState", () => {
  beforeEach(() => {
    useTuiState.setState(initialState, true);
  });

  it("updates input value directly", () => {
    useTuiState.setState((state) => ({
      input: { ...state.input, value: "new value" },
    }));

    expect(useTuiState.getState().input.value).toBe("new value");
  });

  it("updates token count directly", () => {
    useTuiState.setState({ tokenCount: 1234 });

    expect(useTuiState.getState().tokenCount).toBe(1234);
  });

  it("replaces messages directly", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "text" as const, content: "Hi there!" },
    ];

    useTuiState.setState({ messages });

    expect(useTuiState.getState().messages).toBe(messages);
  });
});
