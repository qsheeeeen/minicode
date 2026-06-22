// Scene: tool-call flow — user asks → thinking → tool_use → tool_result → answer.
// Run: bun run src/ui/tui/demos/scenes/tool-flow.tsx
import { useEffect } from "react";
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { MessageList } from "../../MessageList.js";

function Scene() {
  useEffect(() => {
    useTuiState.setState({
      messages: [{ role: "user", content: "What's in package.json?" }],
      isLoading: true,
    });
    const steps = [
      setTimeout(
        () =>
          useTuiState.setState((s) => ({
            messages: [
              ...s.messages,
              { role: "thinking", content: "Reading package.json." },
            ],
          })),
        800,
      ),
      setTimeout(
        () =>
          useTuiState.setState((s) => ({
            messages: [
              ...s.messages,
              {
                role: "tool",
                name: "Read",
                input: { path: "package.json" },
                output: '{\n  "name": "demo",\n  "version": "1.0.0"\n}',
                slotId: "s1",
              },
            ],
          })),
        1800,
      ),
      setTimeout(
        () =>
          useTuiState.setState((s) => ({
            messages: [
              ...s.messages,
              {
                role: "text",
                content: 'The project is named "demo", version 1.0.0.',
              },
            ],
            isLoading: false,
          })),
        3000,
      ),
    ];
    return () => steps.forEach(clearTimeout);
  }, []);
  return (
    <Box flexDirection="column" padding={1}>
      <MessageList />
    </Box>
  );
}

render(<Scene />);
