// Standalone demo for Status component.
// Run: bun run src/ui/tui/demos/widgets/status.tsx
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { Status } from "../../Status.js";

useTuiState.setState({ isLoading: true, pendingPrompt: null });
render(
  <Box flexDirection="column" padding={1}>
    <Status />
  </Box>,
);
useTuiState.setState({
  isLoading: true,
  pendingPrompt: {
    message: "Pick one",
    options: [{ label: "A", value: "a" }],
    resolve: () => {},
  } as any,
});
render(
  <Status />,
);
