import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ProviderConfig } from '../config.js';

export interface InputComponentProps {
  onSubmit?: (value: string) => void;  // For TextInput - actual LLM submission
  onCancel?: () => void;
  onExecute?: (value: string) => void;  // For custom inputs - command execution
  value?: string;
  onChange?: (value: string) => void;
  inputKey?: number;
}

/** Chat input - default text input */
export function ChatInput({ onSubmit, value, onChange, inputKey }: InputComponentProps & { inputKey?: number }) {
  return (
    <TextInput
      key={inputKey}
      value={value || ''}
      onChange={onChange || (() => {})}
      onSubmit={onSubmit}
      placeholder="Type a message or /command..."
    />
  );
}

/** Effort selection input - inline selector */
export function EffortSelectInput({ onExecute, onCancel }: InputComponentProps) {
  const options = ['low', 'medium', 'high', 'xhigh', 'max'];
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.return) {
      onExecute?.(options[selectedIndex]);
    } else if (key.escape && onCancel) {
      onCancel();
    } else if (key.leftArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">Effort: </Text>
        {options.map((opt, i) => (
          <Text key={opt} color={i === selectedIndex ? 'cyan' : 'white'} bold={i === selectedIndex}>
            {i === selectedIndex ? `>${opt}<` : opt}
            {i < options.length - 1 && ' '}
          </Text>
        ))}
      </Box>
      <Text dimColor>← → navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}

/** Session list input - inline selector */
export function SessionListInput({
  onExecute,
  onCancel,
  sessions = [],
}: InputComponentProps & { sessions?: Array<{ name: string }> }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.return && sessions.length > 0) {
      onExecute?.(sessions[selectedIndex]?.name);
    } else if (key.escape && onCancel) {
      onCancel();
    } else if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(sessions.length - 1, prev + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="blue">Sessions:</Text>
      {sessions.map((s, i) => (
        <Text key={s.name} color={i === selectedIndex ? 'blue' : 'white'} bold={i === selectedIndex}>
          {i === selectedIndex ? '> ' : '  '}{s.name}
        </Text>
      ))}
      <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}

/** Model selection input - two-step provider then model */
export function ModelSelectInput({
  onExecute, onCancel,
  providers = {},
}: InputComponentProps & { providers?: Record<string, ProviderConfig> }) {
  const [step, setStep] = useState<'provider' | 'model'>('provider');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState('');

  const providerNames = Object.keys(providers).filter(k => providers[k]?.apiKey);
  const modelNames = selectedProvider
    ? Object.keys(providers[selectedProvider]?.models ?? {})
    : [];
  const items = step === 'provider' ? providerNames : modelNames;

  useInput((_input, key) => {
    if (key.return && items.length > 0) {
      if (step === 'provider') {
        setSelectedProvider(items[selectedIndex]);
        setSelectedIndex(0);
        setStep('model');
      } else {
        onExecute?.(`${items[selectedIndex]}@${selectedProvider}`);
      }
    } else if (key.escape) {
      if (step === 'model') {
        setStep('provider');
        setSelectedIndex(providerNames.indexOf(selectedProvider));
      } else if (onCancel) {
        onCancel();
      }
    } else if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
    }
  });

  const label = step === 'provider' ? 'Provider:' : `Models for ${selectedProvider}:`;

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">{label}</Text>
      {items.map((name, i) => (
        <Text key={name} color={i === selectedIndex ? 'magenta' : 'white'} bold={i === selectedIndex}>
          {i === selectedIndex ? '> ' : '  '}{name}
        </Text>
      ))}
      <Text dimColor>↑↓ navigate, Enter select, Esc {step === 'model' ? 'back' : 'cancel'}</Text>
    </Box>
  );
}

/** Confirm input - yes/no prompt */
export function ConfirmInput({
  onExecute,
  onCancel,
  message = 'Confirm?',
}: InputComponentProps & { message?: string }) {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected(prev => prev === 'yes' ? 'no' : 'yes');
    } else if (key.return) {
      onExecute?.(selected);
    } else if (key.escape && onCancel) {
      onCancel();
    } else if (_input === 'y') {
      onExecute?.('yes');
    } else if (_input === 'n') {
      onExecute?.('no');
    }
  });

  return (
    <Box>
      <Text>{message} </Text>
      <Text bold color={selected === 'yes' ? 'green' : 'white'}>[Y]</Text>
      <Text color="gray">/</Text>
      <Text bold color={selected === 'no' ? 'red' : 'white'}>[N]</Text>
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