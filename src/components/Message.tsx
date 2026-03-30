import React from 'react';
import { Box, Text } from 'ink';
import { type DiffLine } from '../utils/diff.js';

/** Parse compact diff summary text (from formatResult) into structured lines */
function parseDiffContent(content: string): DiffLine[] | null {
  // Compact format: first line is "path: -N/+N lines", rest are "  + ..." or "  - ..."
  const lines = content.split('\n');
  if (lines.length < 2) return null;
  if (!lines[0].includes(': -') || !lines[0].includes('/+')) return null;

  const result: DiffLine[] = [];
  // Header line
  result.push({ type: 'header', content: lines[0] });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('  + ')) {
      result.push({ type: 'add', content: line });
    } else if (line.startsWith('  - ')) {
      result.push({ type: 'remove', content: line });
    } else if (line.trim() === '') {
      continue;
    } else {
      return null; // Not a valid diff
    }
  }

  if (!result.some(l => l.type === 'add' || l.type === 'remove')) return null;
  return result;
}

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking';
  content: string;
  isStreaming?: boolean;
}

export function Message({ role, content, isStreaming }: MessageProps) {
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

  // Tool result - check for diff format, otherwise dim color
  if (role === 'tool_result') {
    // Try to parse as edit diff result (from formatResult)
    const diffLines = parseDiffContent(content);
    if (diffLines) {
      return (
        <Box marginBottom={0} paddingX={8} flexDirection="column">
          {diffLines.map((line, i) => (
            <Text key={i} color={
              line.type === 'add' ? 'green' :
              line.type === 'remove' ? 'red' :
              line.type === 'header' ? 'gray' : 'gray'
            }>{line.content}</Text>
          ))}
        </Box>
      );
    }
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
