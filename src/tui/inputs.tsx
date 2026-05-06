import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, TextInput, ConfirmInput as InkConfirmInput } from '@inkjs/ui';
import type { ProviderConfig } from '../config.js';

export interface InputComponentProps {
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onExecute?: (value: string) => void;
  value?: string;
  onChange?: (value: string) => void;
  inputKey?: number;
}

/** Chat input - default text input */
export function ChatInput({ onSubmit, value, onChange, inputKey }: InputComponentProps & { inputKey?: number }) {
  return (
    <TextInput
      key={inputKey}
      defaultValue={value || ''}
      onChange={onChange || (() => {})}
      onSubmit={onSubmit}
      placeholder="Type a message or /command..."
    />
  );
}

/** Effort selection input */
export function EffortSelectInput({ onExecute, onCancel }: InputComponentProps) {
  useInput((_input, key) => {
    if (key.escape && onCancel) onCancel();
  });

  const options = [
    { label: 'low', value: 'low' },
    { label: 'medium', value: 'medium' },
    { label: 'high', value: 'high' },
    { label: 'xhigh', value: 'xhigh' },
    { label: 'max', value: 'max' },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Effort:</Text>
      <Select options={options} onChange={(v) => onExecute?.(v)} />
      <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}

/** Session list input */
export function SessionListInput({
  onExecute,
  onCancel,
  sessions = [],
}: InputComponentProps & { sessions?: Array<{ name: string }> }) {
  useInput((_input, key) => {
    if (key.escape && onCancel) onCancel();
  });

  const options = sessions.map(s => ({ label: s.name, value: s.name }));

  return (
    <Box flexDirection="column">
      <Text bold color="blue">Sessions:</Text>
      {options.length > 0 ? (
        <Select options={options} onChange={(v) => onExecute?.(v)} />
      ) : (
        <Text dimColor>No sessions found</Text>
      )}
      <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}

/** Model selection input - two-step: provider then model */
export function ModelSelectInput({
  onExecute, onCancel,
  providers = {},
}: InputComponentProps & { providers?: Record<string, ProviderConfig> }) {
  const [step, setStep] = useState<'provider' | 'model'>('provider');
  const [selectedProvider, setSelectedProvider] = useState('');

  useInput((_input, key) => {
    if (key.escape) {
      if (step === 'model') {
        setStep('provider');
      } else if (onCancel) {
        onCancel();
      }
    }
  });

  if (step === 'provider') {
    const options = Object.keys(providers)
      .filter(k => providers[k]?.apiKey)
      .map(k => ({ label: k, value: k }));

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">Provider:</Text>
        {options.length > 0 ? (
          <Select options={options} onChange={(v) => { setSelectedProvider(v); setStep('model'); }} />
        ) : (
          <Text dimColor>No providers configured</Text>
        )}
        <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
      </Box>
    );
  }

  const options = Object.keys(providers[selectedProvider]?.models ?? {})
    .map(k => ({ label: k, value: `${k}@${selectedProvider}` }));

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">Models for {selectedProvider}:</Text>
      {options.length > 0 ? (
        <Select options={options} onChange={(v) => onExecute?.(v)} />
      ) : (
        <Text dimColor>No models found</Text>
      )}
      <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
    </Box>
  );
}

/** Confirm input - yes/no prompt */
export function ConfirmInput({
  onExecute,
  onCancel,
  message = 'Confirm?',
}: InputComponentProps & { message?: string }) {
  return (
    <Box gap={1}>
      <Text>{message}</Text>
      <InkConfirmInput
        onConfirm={() => onExecute?.('yes')}
        onCancel={onCancel || (() => onExecute?.('no'))}
      />
    </Box>
  );
}

/** Input component registry */
export interface InputComponentRegistration {
  name: string;
  Component: React.ComponentType<InputComponentProps>;
}

export const inputComponents: InputComponentRegistration[] = [
  { name: 'chat', Component: ChatInput },
  { name: 'effort-select', Component: EffortSelectInput },
  { name: 'session-list', Component: SessionListInput },
  { name: 'model-select', Component: ModelSelectInput },
  { name: 'confirm', Component: ConfirmInput },
];

export function getInputComponent(name: string): React.ComponentType<InputComponentProps> {
  const found = inputComponents.find(c => c.name === name);
  return found?.Component || ChatInput;
}
