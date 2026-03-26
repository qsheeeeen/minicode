import React from 'react';
import { Box, Text } from 'ink';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  content: string;
  isStreaming?: boolean;
}

// Format tool content to extract tool name
function formatToolContent(content: string): { tool: string; rest: string } {
  // Extract tool name from patterns like "Read(package.json)" or "(Read 28 lines, 582 chars)"
  const match = content.match(/^(\w+)\((.*?)\)/);
  if (match) {
    return { tool: match[1], rest: match[2] };
  }
  const match2 = content.match(/^\((\w+)\s+(.*?)\)/);
  if (match2) {
    return { tool: match2[1], rest: match2[2] };
  }
  return { tool: 'Tool', rest: content };
}

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

  // Tool call/result
  if (role === 'tool') {
    // Check if it's a tool call (has parentheses like "Read(...)") or result
    const isToolCall = /^[A-Z]\w+\(/.test(content);
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
