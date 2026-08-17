import { Box, Text } from "ink";
import { useTuiState } from "./state.js";
import { Message } from "./Message.js";

export function MessageList() {
  const messages = useTuiState((s) => s.messages);

  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>Type a message to start...</Text>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      {messages
        .filter((msg) => msg.role === "tool" || !!msg.content)
        .map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
    </Box>
  );
}
