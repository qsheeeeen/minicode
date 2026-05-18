import React from 'react';
import { Box, Text } from 'ink';
import { Select, MultiSelect } from '@inkjs/ui';
import { useTuiState, useTuiDispatch } from './store.js';

function alignOptions(options: Array<{ label: string; value: string; description?: string }>): Array<{ label: string; value: string }> {
  const maxLen = Math.max(...options.map(o => o.label.length));
  return options.map(o => ({
    label: o.description
      ? `${o.label.padEnd(maxLen)}  ${o.description}`
      : o.label,
    value: o.value,
  }));
}

export function ModalPrompter() {
  const { pendingPrompt } = useTuiState();
  const dispatch = useTuiDispatch();

  if (!pendingPrompt) return null;

  const aligned = alignOptions(pendingPrompt.options);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
        <Text>{pendingPrompt.message}</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box flexBasis={3} flexShrink={0}>
          <Text color="cyan" bold>{'>'}</Text>
        </Box>
        {pendingPrompt.multiSelect ? (
          <Box flexDirection="column">
            <MultiSelect
              options={aligned}
              onSubmit={(values) => {
                pendingPrompt.resolve(values.join(', '));
                dispatch({ type: 'SET_PENDING_PROMPT', payload: null });
              }}
            />
            <Text dimColor>Space select  Enter confirm  Esc cancel</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Select
              options={aligned}
              onChange={(value) => {
                pendingPrompt.resolve(value);
                dispatch({ type: 'SET_PENDING_PROMPT', payload: null });
              }}
            />
            <Text dimColor>↑↓ navigate  Enter select  Esc cancel</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
