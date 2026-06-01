import { Box, Text } from "ink";
import type { DisplayMessage } from "../../messages.js";
import { ToolDisplay } from "./tool-display.js";

export function Message({ msg }: { msg: DisplayMessage }) {
  switch (msg.role) {
    case "user":
      return (
        <Box marginBottom={1} paddingX={1} backgroundColor="gray">
          <Text color="white" bold>
            {msg.content.trim() || " "}
          </Text>
        </Box>
      );

    case "text":
      return (
        <Box marginBottom={1}>
          <Text>
            {msg.isStreaming ? msg.content : msg.content.trim() || " "}
          </Text>
        </Box>
      );

    case "thinking":
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text color="gray" italic>
            Thinking
          </Text>
          <Box>
            <Text dimColor>
              {msg.isStreaming ? msg.content : msg.content.trim()}
            </Text>
          </Box>
        </Box>
      );

    case "tool":
      return (
        <Box marginBottom={1}>
          <ToolDisplay name={msg.name} input={msg.input} output={msg.output} />
        </Box>
      );

    case "status":
      if (msg.toolDisplay) {
        return (
          <Box marginBottom={1}>
            <ToolDisplay
              name={msg.toolDisplay.name}
              input={msg.toolDisplay.input}
              output={msg.toolDisplay.output}
            />
          </Box>
        );
      }
      if (msg.element) return <Box marginBottom={1}>{msg.element}</Box>;
      return (
        <Box marginBottom={1}>
          <Text color="white">
            {"—"} {msg.content}
          </Text>
        </Box>
      );

    case "error":
      return (
        <Box marginBottom={1}>
          <Text color="red" bold>
            {"✕"} {msg.content}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}
