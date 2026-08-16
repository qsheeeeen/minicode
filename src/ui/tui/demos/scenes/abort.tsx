// Scene: abort — agent running mid-stream, user aborts.
// Run: bun run src/ui/tui/demos/scenes/abort.tsx
import { useEffect } from "react";
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { MessageList } from "../../MessageList.js";
import { Status } from "../../Status.js";

function Scene() {
  useEffect(() => {
    useTuiState.setState({
      messages: [{ role: "user", content: "Run the full migration." }],
      isLoading: true,
    });
    const steps = [
      setTimeout(
        () =>
          useTuiState.setState((s) => ({
            messages: [
              ...s.messages,
              {
                role: "thinking",
                content: "Starting migration, this will take a while...",
              },
            ],
          })),
        800,
      ),
      setTimeout(() => useTuiState.setState({ isLoading: false }), 2500),
    ];
    return () => steps.forEach(clearTimeout);
  }, []);
  return (
    <Box flexDirection="column" padding={1}>
      <MessageList />
      <Status />
    </Box>
  );
}

render(<Scene />);
