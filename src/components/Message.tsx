import React from 'react';
import { Box, Text } from 'ink';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error' | 'thinking';
  content: string;
  isStreaming?: boolean;
}

// Tool names for detection (all built-in tools start with uppercase)
const TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash'];

export function Message({ role, content, isStreaming }: MessageProps) {
  // User message - dim color to distinguish from assistant
  if (role === 'user') {
    return (
      <Box marginBottom={0} paddingX={0} width="100%">
        <Text dimColor>{content}</Text>
      </Box>
    );
  }

  // Assistant message - clean text
  if (role === 'assistant') {
    return (
      <Box marginBottom={0} paddingX={1} flexDirection="column">
        <Text>{content}</Text>
      </Box>
    );
  }

  // Thinking message - dim, folded
  if (role === 'thinking') {
    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
    return (
      <Box marginBottom={0} paddingX={1} flexDirection="column">
        <Text color="gray">[Thinking] {preview}</Text>
      </Box>
    );
  }

  // Tool call/result
  if (role === 'tool') {
    // Check if it's a tool call by matching known tool names followed by parenthesis
    const isToolCall = TOOL_NAMES.some(name => content.startsWith(`${name}(`));
    if (isToolCall) {
      // Tool call - show in yellow
      return (
        <Box marginBottom={0} paddingX={1}>
          <Text color="yellow">{content}</Text>
        </Box>
      );
    } else {
      // Tool result - dim color
      return (
        <Box marginBottom={0} paddingX={2}>
          <Text dimColor>{content}</Text>
        </Box>
      );
    }
  }

  // System message - dim gray bracket prefix
  if (role === 'system') {
    return (
      <Box marginBottom={0}>
        <Text color="gray">[System]</Text>
        <Text dimColor> {content}</Text>
      </Box>
    );
  }

  // Error message - red text, no background
  if (role === 'error') {
    return (
      <Box marginBottom={0}>
        <Text color="red">[Error] {content}</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={0}>
      <Text>{content}</Text>
    </Box>
  );
}
