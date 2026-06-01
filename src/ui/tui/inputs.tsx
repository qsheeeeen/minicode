import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import type { ProviderConfig } from "#src/config.js";

export interface InputComponentProps {
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onExecute?: (value: string) => void;
  value?: string;
  onChange?: (value: string) => void;
  inputKey?: number;
}

/** Chat input - default text input */
export function ChatInput({
  onSubmit,
  value,
  onChange,
  inputKey,
}: InputComponentProps & { inputKey?: number }) {
  return (
    <TextInput
      key={inputKey}
      defaultValue={value || ""}
      onChange={onChange || (() => {})}
      onSubmit={onSubmit}
      placeholder="Type a message or /command..."
    />
  );
}

/** Effort selection input */
export function EffortSelectInput({
  onExecute,
  onCancel,
}: InputComponentProps) {
  useInput((_input, key) => {
    if (key.escape && onCancel) onCancel();
  });

  const options = [
    { label: "low", value: "low" },
    { label: "medium", value: "medium" },
    { label: "high", value: "high" },
    { label: "xhigh", value: "xhigh" },
    { label: "max", value: "max" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Effort:
      </Text>
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

  const options = sessions.map((s) => ({ label: s.name, value: s.name }));

  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        Sessions:
      </Text>
      {options.length > 0 ? (
        <Select options={options} onChange={(v) => onExecute?.(v)} />
      ) : (
        <Text dimColor>No sessions found</Text>
      )}
      <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}

/** Model selection input - tier-based with optional edit flow */
export function ModelSelectInput({
  onExecute,
  onCancel,
  providers = {},
  tiers = {},
}: InputComponentProps & {
  providers?: Record<string, ProviderConfig>;
  tiers?: Record<string, string>;
}) {
  const [step, setStep] = useState<"main" | "edit-tier" | "provider" | "model">(
    "main",
  );
  const [editTier, setEditTier] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "model") {
        setStep("provider");
      } else if (step === "provider") {
        setStep("edit-tier");
      } else if (step === "edit-tier") {
        setStep("main");
      } else if (onCancel) {
        onCancel();
      }
    }
  });

  // ── Main: tiers + edit entry ──
  if (step === "main") {
    const tierLabels = ["1", "2", "3"];
    const options = [
      ...tierLabels.map((t) => ({
        label: `Tier ${t} → ${tiers[t] || "(unset)"}`,
        value: `${t}:`,
      })),
      { label: "Edit tier mapping...", value: "_edit_" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          Select tier:
        </Text>
        <Select
          options={options}
          onChange={(v) => {
            if (v === "_edit_") {
              setStep("edit-tier");
            } else {
              onExecute?.(v);
            }
          }}
        />
        <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
      </Box>
    );
  }

  // ── Edit: pick tier to reconfigure ──
  if (step === "edit-tier") {
    const tierLabels = ["1", "2", "3"];
    const options = tierLabels.map((t) => ({
      label: `Tier ${t} → ${tiers[t] || "(unset)"}`,
      value: t,
    }));

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          Edit which tier?
        </Text>
        <Select
          options={options}
          onChange={(v) => {
            setEditTier(v);
            setStep("provider");
          }}
        />
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
      </Box>
    );
  }

  // ── Edit: pick provider ──
  if (step === "provider") {
    const options = Object.keys(providers)
      .filter((k) => providers[k]?.apiKey)
      .map((k) => ({ label: k, value: k }));

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          Provider for Tier {editTier}:
        </Text>
        {options.length > 0 ? (
          <Select
            options={options}
            onChange={(v) => {
              setSelectedProvider(v);
              setStep("model");
            }}
          />
        ) : (
          <Text dimColor>No providers configured</Text>
        )}
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
      </Box>
    );
  }

  // ── Edit: pick model ──
  const options = Object.keys(providers[selectedProvider]?.models ?? {}).map(
    (k) => ({ label: k, value: `${editTier}:${k}@${selectedProvider}` }),
  );

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        Model for Tier {editTier} @{selectedProvider}:
      </Text>
      {options.length > 0 ? (
        <Select options={options} onChange={(v) => onExecute?.(v)} />
      ) : (
        <Text dimColor>No models found</Text>
      )}
      <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
    </Box>
  );
}

/** Input component registry */
export interface InputComponentRegistration {
  name: string;
  Component: React.ComponentType<InputComponentProps>;
}

export const inputComponents: InputComponentRegistration[] = [
  { name: "chat", Component: ChatInput },
  { name: "effort-select", Component: EffortSelectInput },
  { name: "session-list", Component: SessionListInput },
  { name: "model-select", Component: ModelSelectInput },
];

export function getInputComponent(
  name: string,
): React.ComponentType<InputComponentProps> {
  const found = inputComponents.find((c) => c.name === name);
  return found?.Component || ChatInput;
}
