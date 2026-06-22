// Standalone demo for MessageList component.
// Run: bun run src/ui/tui/demos/widgets/message-list.tsx
import { render, Box } from "ink";
import { useTuiState } from "../../state.js";
import { MessageList } from "../../MessageList.js";
import { sampleMessages } from "../fixtures.js";

useTuiState.setState({ messages: sampleMessages });
render(
  <Box flexDirection="column" padding={1}>
    <MessageList />
  </Box>,
);
