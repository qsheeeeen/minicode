// Standalone demo for SubAgentBar component.
// Run: bun run src/ui/tui/demos/widgets/sub-agent-bar.tsx
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { SubAgentBar } from "../../SubAgentBar.js";
import { sampleSessions } from "../fixtures.js";

useTuiState.setState({ agentSessions: sampleSessions, activeAgentId: "1" });
render(
  <Box flexDirection="column" padding={1}>
    <SubAgentBar />
  </Box>,
);
