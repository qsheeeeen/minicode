import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach } from "vitest";
import { MessageList } from "./MessageList.js";
import { useTuiState, initialState } from "./state.js";

describe("MessageList Component", () => {
  beforeEach(() => {
    useTuiState.setState(initialState, true);
  });

  it("shows welcome text when there are no messages", () => {
    useTuiState.setState({ messages: [] });
    const { lastFrame } = render(<MessageList />);

    const output = lastFrame();
    expect(output).toContain("Type a message to start");
  });

  it("renders a list of messages", () => {
    useTuiState.setState({
      messages: [
        { role: "user", content: "Hello", timestamp: new Date() },
        { role: "text", content: "Hi there!", timestamp: new Date() },
      ],
    });
    const { lastFrame } = render(<MessageList />);

    const output = lastFrame();
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });
});
