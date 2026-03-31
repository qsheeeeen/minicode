import React from 'react';
import { Box, Text } from 'ink';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking';
  content: string;
  isStreaming?: boolean;
  element?: React.ReactElement;
}

export function Message({ role, content, isStreaming, element }: MessageProps) {
  // User message - dim color to distinguish from assistant
  if (role === 'user') {
    return (
      <Box marginBottom={0} paddingX={0} width="100%">
        <Text backgroundColor="gray" color="white">{content}</Text>
      </Box>
    );
  }

  // Assistant message - clean text
  if (role === 'assistant') {
    return (
      <Box marginBottom={0} paddingX={4} flexDirection="column">
        <Text>{content}</Text>
        {isStreaming && <Text dimColor inverse>▋</Text>}
      </Box>
    );
  }

  // Thinking message - dim, folded
  if (role === 'thinking') {
    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
    return (
      <Box marginBottom={0} paddingX={4} flexDirection="column">
        <Text dimColor>{preview}</Text>
        {isStreaming && <Text dimColor inverse>▋</Text>}
      </Box>
    );
  }

  // Tool call - show in yellow
  if (role === 'tool') {
    return (
      <Box marginBottom={0} paddingX={4}>
        <Text color="yellow">{content}</Text>
      </Box>
    );
  }

  // Tool result - use element from tool if available, otherwise dim text
  if (role === 'tool_result') {
    if (element) return element;
    return (
      <Box marginBottom={0} paddingX={8}>
        <Text dimColor>{content}</Text>
      </Box>
    );
  }

  // System message - dim gray, with same indent as tool call
  if (role === 'system') {
    return (
      <Box marginBottom={0} paddingX={4}>
        <Text dimColor>{content}</Text>
      </Box>
    );
  }

  // Error message - red text, no background
  if (role === 'error') {
    return (
      <Box marginBottom={0}>
        <Text color="red">{content}</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={0}>
      <Text>{content}</Text>
    </Box>
  );
}
