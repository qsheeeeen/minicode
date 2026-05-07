import React from 'react';
import { Box, Text } from 'ink';
import type { MessageRole } from '../messages.js';

interface MessageProps {
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
  element?: React.ReactElement;
}

export function Message({ role, content, isStreaming, element }: MessageProps) {
  if (!element && !content && !isStreaming && role !== 'user') return null;

  const text = isStreaming ? content : content.trim();

  switch (role) {
    case 'user':
      return (
        <Box marginBottom={0} paddingX={1} backgroundColor="gray">
          <Text color="white" bold>{text}</Text>
        </Box>
      );

    case 'text':
      return (
        <Box marginBottom={0} flexDirection="column">
          <Text>{text}</Text>
          {isStreaming && <Text dimColor inverse>▋</Text>}
        </Box>
      );

    case 'thinking':
      return (
        <Box marginBottom={0} flexDirection="column">
          <Text color="gray" italic>Thinking</Text>
          <Box>
            <Text dimColor>{text}</Text>
            {isStreaming && <Text dimColor inverse>▋</Text>}
          </Box>
        </Box>
      );

    case 'tool_use':
      if (element) return element;
      return (
        <Box marginBottom={0} paddingLeft={2}>
          <Text dimColor>{'▸'} {text}</Text>
        </Box>
      );

    case 'tool_result':
      return (
        <Box marginBottom={0} paddingLeft={4}>
          <Text dimColor>{text}</Text>
        </Box>
      );

    case 'status':
      if (element) return element;
      return (
        <Box marginBottom={0} paddingLeft={2}>
          <Text color="gray">{'—'} {text}</Text>
        </Box>
      );

    case 'error':
      return (
        <Box marginBottom={0} paddingLeft={2}>
          <Text color="red" bold>{'✕'} {text}</Text>
        </Box>
      );

    default:
      return (
        <Box marginBottom={0}>
          <Text>{text}</Text>
        </Box>
      );
  }
}
