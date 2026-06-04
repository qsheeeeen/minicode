import { Box, Text } from "ink";
import { StatusMessage } from "@inkjs/ui";
import Markdown from "ink-markdown-es";
import type { DisplayMessage } from "../../messages.js";
import { ToolDisplay } from "./tool-display.js";

const markdownStyles = {
  h1: { bold: true, color: undefined },
  h2: { bold: true, color: undefined },
  h3: { bold: true, color: undefined },
  h4: { bold: true, color: undefined },
  h5: { bold: true, color: undefined },
  h6: { bold: true, color: undefined },
};

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
          <Markdown showSharp styles={markdownStyles}>{msg.content.trim() || " "}</Markdown>
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
          <StatusMessage variant="info">{msg.content}</StatusMessage>
        </Box>
      );

    case "error":
      return (
        <Box marginBottom={1}>
          <StatusMessage variant="error">{msg.content}</StatusMessage>
        </Box>
      );

    default:
      return null;
  }
}

