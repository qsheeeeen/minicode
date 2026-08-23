import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { TIERS, type ProviderConfig, type Tier } from "../../config.js";
import type { ChangeEntry } from "../../services/change-journal.js";

export interface InputComponentProps {
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onExecute?: (value: string) => void;
  value?: string;
  onChange?: (value: string) => void;
  inputKey?: number;
}

// Chat input - default text input
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

// Effort selection input
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

// Session list input
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Model selection input - tier-based with optional edit flow
export function ModelSelectInput({
  onExecute,
  onCancel,
  providers = {},
  tiers = {},
  activeTier,
}: InputComponentProps & {
  providers?: Record<string, ProviderConfig>;
  tiers?: Partial<Record<Tier, string>>;
  activeTier?: Tier;
}) {
  const [step, setStep] = useState<
    "main" | "edit-tier" | "provider" | "model" | "manual"
  >("main");
  const [editTier, setEditTier] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "manual") {
        setStep("model");
      } else if (step === "model") {
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
    const options = [
      ...TIERS.map((t) => ({
        label: `${capitalize(t)} → ${tiers[t] || "(unset)"}${t === activeTier ? " (active)" : ""}`,
        value: `${t}:`,
      })),
      { label: "Edit tier mapping...", value: "_edit_" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          Select model:
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
    const options = TIERS.map((t) => ({
      label: `${capitalize(t)} → ${tiers[t] || "(unset)"}`,
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
          Provider for {capitalize(editTier)}:
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

  // ── Edit: pick model (declared ones + manual entry) ──
  if (step === "model") {
    const models = providers[selectedProvider]?.models ?? {};
    const options = [
      ...Object.keys(models).map((k) => ({
        label: models[k]?.name || k,
        value: `${editTier}:${k}@${selectedProvider}`,
      })),
      { label: "Enter a model id manually...", value: "_manual_" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          Model for {capitalize(editTier)} @{selectedProvider}:
        </Text>
        <Select
          options={options}
          onChange={(v) => {
            if (v === "_manual_") {
              setStep("manual");
            } else {
              onExecute?.(v);
            }
          }}
        />
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
      </Box>
    );
  }

  // ── Edit: manual model id (works for ids not declared in config) ──
  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        Model id for {capitalize(editTier)} @{selectedProvider}:
      </Text>
      <TextInput
        placeholder="e.g. glm-4.7"
        onSubmit={(v) => {
          const id = v.trim();
          if (id) onExecute?.(`${editTier}:${id}@${selectedProvider}`);
        }}
      />
      <Text dimColor>
        Type an id (declared in config or not), Enter confirm, Esc back
      </Text>
    </Box>
  );
}

// Undo: two-step rollback UI (select user message → select scope)
export function UndoInput({
  onExecute,
  onCancel,
  entriesByUserMessage = [],
  messageIds = [],
  userMessages = [],
  totalUserMessages = 0,
}: InputComponentProps & {
  entriesByUserMessage?: Array<{
    userMessageId: string;
    entries: ChangeEntry[];
  }>;
  /** Stable message ids, parallel to `userMessages` by position. */
  messageIds?: string[];
  userMessages?: string[];
  totalUserMessages?: number;
}) {
  const [step, setStep] = useState<"list" | "confirm">("list");
  const [selectedUserMessageOrdinal, setSelectedUserMessageOrdinal] =
    useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "confirm") {
        setStep("list");
      } else if (onCancel) {
        onCancel();
      }
    }
  });

  const userMessageCount = totalUserMessages || userMessages.length;

  if (userMessageCount === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing to rollback</Text>
      </Box>
    );
  }

  if (step === "list") {
    const entriesMap = new Map(
      entriesByUserMessage.map((e) => [e.userMessageId, e]),
    );
    const options = [];
    for (let i = userMessageCount; i >= 1; i--) {
      const msg = userMessages[i - 1] || "(unknown)";
      const summary = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
      const entry = entriesMap.get(messageIds[i - 1]);
      let label = `${i}. "${summary}"`;
      if (entry) {
        const files = entry.entries
          .map((e) => e.path.split("/").pop())
          .join(", ");
        label += ` — ${entry.entries.length} file${entry.entries.length > 1 ? "s" : ""} (${files})`;
      }
      options.push({ label, value: String(i) });
    }
    options.push({ label: "Cancel", value: "_cancel_" });

    return (
      <Box flexDirection="column">
        <Text bold color="yellow">
          Select a user message to rollback to:
        </Text>
        <Select
          options={options}
          onChange={(v) => {
            if (v === "_cancel_") {
              onCancel?.();
            } else {
              setSelectedUserMessageOrdinal(Number(v));
              setStep("confirm");
            }
          }}
        />
        <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
      </Box>
    );
  }

  // Confirm step
  const selected = entriesByUserMessage.find(
    (e) => e.userMessageId === messageIds[selectedUserMessageOrdinal - 1],
  );
  const hasFiles = selected && selected.entries.length > 0;
  const msg = userMessages[selectedUserMessageOrdinal - 1] || "(unknown)";

  const scopeOptions = [{ label: "Conversation", value: "conversation" }];
  if (hasFiles) {
    scopeOptions.push({ label: "Conversation + code", value: "both" });
  }
  scopeOptions.push({ label: "Cancel", value: "cancel" });

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        Rollback to before user message {selectedUserMessageOrdinal}: "
        {msg.length > 50 ? msg.slice(0, 50) + "..." : msg}"
      </Text>
      {hasFiles && (
        <>
          <Text>Files to restore:</Text>
          {selected.entries.map((e) => (
            <Text key={e.path}>
              {"  "}- {e.path} ({e.op})
            </Text>
          ))}
        </>
      )}
      <Select
        options={scopeOptions}
        onChange={(v) => {
          if (v === "cancel") {
            onCancel?.();
            return;
          }
          // Feed a fully parameterized command back through the input
          // pipeline — execution lives in the command layer (works headless).
          onExecute?.(`/undo ${selectedUserMessageOrdinal} ${v}`);
        }}
      />
      <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
    </Box>
  );
}

// Fork: pick a user message to branch from (non-destructive rewind)
export function ForkInput({
  onExecute,
  onCancel,
  messageIds = [],
  userMessages = [],
}: InputComponentProps & {
  /** Stable message ids, parallel to `userMessages` by position. */
  messageIds?: string[];
  userMessages?: string[];
}) {
  useInput((_input, key) => {
    if (key.escape) onCancel?.();
  });

  if (userMessages.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing to fork</Text>
      </Box>
    );
  }

  const options = [];
  for (let i = userMessages.length; i >= 1; i--) {
    const msg = userMessages[i - 1] || "(unknown)";
    const summary = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
    options.push({ label: `${i}. "${summary}"`, value: String(i) });
  }
  options.push({ label: "Cancel", value: "_cancel_" });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Fork to before a user message (branch is kept):
      </Text>
      <Select
        options={options}
        onChange={(v) => {
          if (v === "_cancel_") {
            onCancel?.();
          } else {
            // Execution lives in the command layer (works headless).
            onExecute?.(`/fork ${v}`);
          }
        }}
      />
      <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
    </Box>
  );
}
