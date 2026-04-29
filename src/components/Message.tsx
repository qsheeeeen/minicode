import React from 'react';
import { Box, Text } from 'ink';

interface MessageProps {
  role: 'user' | 'assistant' | 'status' | 'tool' | 'tool_result' | 'error' | 'thinking';
  content: string;
  isStreaming?: boolean;
  element?: React.ReactElement;
}

export function Message({ role, content, isStreaming, element }: MessageProps) {
  if (!element && !content && !isStreaming && role !== 'user') return null;

  // Trim content whitespace when finalized to prevent blank lines from LLM output
  const text = isStreaming ? content : content.trim();

  if (role === 'user') {
    return (
      <Box marginBottom={0} paddingX={0} width="100%">
        <Text backgroundColor="gray" color="white">{text}</Text>
      </Box>
    );
  }

  if (role === 'assistant') {
    return (
      <Box marginBottom={0} paddingX={0} flexDirection="column">
        <Text>{text}</Text>
        {isStreaming && <Text dimColor inverse>▋</Text>}
      </Box>
    );
  }

  if (role === 'thinking') {
    return (
      <Box marginBottom={0} paddingX={0} flexDirection="column">
        <Text dimColor>{text}</Text>
        {isStreaming && <Text dimColor inverse>▋</Text>}
      </Box>
    );
  }

  if (role === 'tool') {
    if (element) return element;
    return (
      <Box marginBottom={0} paddingX={4}>
        <Text color="yellow">{text}</Text>
      </Box>
    );
  }

  if (role === 'tool_result') {
    return null;
  }

  if (role === 'status') {
    if (element) return element;
    return (
      <Box marginBottom={0} paddingX={0}>
        <Text dimColor>{text}</Text>
      </Box>
    );
  }

  if (role === 'error') {
    return (
      <Box marginBottom={0}>
        <Text color="red">{text}</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={0}>
      <Text>{text}</Text>
    </Box>
  );
}
