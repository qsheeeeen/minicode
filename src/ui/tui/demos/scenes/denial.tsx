// Scene: permission denial — agent attempts a tool, user rejects, run stops.
// (No error status: denial is a normal outcome. UI shows the rejected tool_result.)
// Run: bun run src/ui/tui/demos/scenes/denial.tsx
import { useEffect } from "react";
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { MessageList } from "../../MessageList.js";

function Scene() {
  useEffect(() => {
    useTuiState.setState({
      messages: [{ role: "user", content: "Drop the production database." }],
      isLoading: true,
    });
    const steps = [
      setTimeout(
        () =>
          useTuiState.setState((s) => ({
            messages: [
              ...s.messages,
              {
                role: "tool",
                name: "Shell",
                input: { command: "dropdb prod" },
                output: "User rejected",
                slotId: "s1",
              },
            ],
          })),
        1200,
      ),
      setTimeout(() => useTuiState.setState({ isLoading: false }), 2400),
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
