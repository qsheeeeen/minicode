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
  if (!element && !content && !isStreaming) return null;

  const text = isStreaming ? content : content.trim();

  switch (role) {
    case 'user':
      return (
        <Box marginBottom={1} paddingX={1} backgroundColor="gray">
          <Text color="white" bold>{text}</Text>
        </Box>
      );

    case 'text':
      return (
        <Box marginBottom={1}>
          <Text>{text}</Text>
        </Box>
      );

    case 'thinking':
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text color="gray" italic>Thinking</Text>
          <Box>
            <Text dimColor>{text}</Text>
          </Box>
        </Box>
      );

    case 'tool':
      return <Box marginBottom={1}>{element}</Box>;

    case 'status':
      if (element) return <Box marginBottom={1}>{element}</Box>;
      return (
        <Box marginBottom={1} paddingLeft={2}>
          <Text color="gray">{'—'} {text}</Text>
        </Box>
      );

    case 'error':
      return (
        <Box marginBottom={1} paddingLeft={2}>
          <Text color="red" bold>{'✕'} {text}</Text>
        </Box>
      );

    default:
      return (
        <Box marginBottom={1}>
          <Text>{text}</Text>
        </Box>
      );
  }
}
