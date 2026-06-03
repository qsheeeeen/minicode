import React from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./store.js";
import { Message } from "./Message.js";

export function MessageList() {
  const { messages } = useTuiState();

  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>Type a message to start...</Text>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        {messages
          .filter((msg) => {
            if (msg.role === "tool") return true;
            if (msg.role === "status" && msg.element) return true;
            return !!msg.content;
          })
          .map((msg, i) => (
            <Box key={i}>
              <Message msg={msg} />
            </Box>
          ))}
      </Box>
    </Box>
  );
}
