import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import type { ProviderConfig } from "../../config.js";
import type { ChangeEntry } from "../../services/change-journal.js";
import type { Agent } from "../../agent.js";

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    const tierLabels = ["pro", "flash"];
    const options = [
      ...tierLabels.map((t) => ({
        label: `${capitalize(t)} → ${tiers[t] || "(unset)"}`,
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
    const tierLabels = ["pro", "flash"];
    const options = tierLabels.map((t) => ({
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

  // ── Edit: pick model ──
  const models = providers[selectedProvider]?.models ?? {};
  const options = Object.keys(models).map(
    (k) => ({ label: models[k]?.name || k, value: `${editTier}:${k}@${selectedProvider}` }),
  );

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        Model for {capitalize(editTier)} @{selectedProvider}:
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

/** Undo: two-step rollback UI (select turn → select scope) */
export function UndoInput({
  onExecute: _onExecute,
  onCancel,
  entriesByTurn = [],
  userMessages = [],
  totalTurns = 0,
  agent,
}: InputComponentProps & {
  entriesByTurn?: Array<{ turnIdx: number; entries: ChangeEntry[] }>;
  userMessages?: string[];
  totalTurns?: number;
  agent?: Agent;
}) {
  const [step, setStep] = useState<"list" | "confirm">("list");
  const [selectedTurnIdx, setSelectedTurnIdx] = useState(0);
  const [processing, setProcessing] = useState(false);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "confirm") {
        setStep("list");
      } else if (onCancel) {
        onCancel();
      }
    }
  });

  const turnCount = totalTurns || userMessages.length;

  if (turnCount === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing to rollback</Text>
      </Box>
    );
  }

  if (step === "list") {
    const entriesMap = new Map(entriesByTurn.map((e) => [e.turnIdx, e]));
    const options = [];
    for (let i = turnCount; i >= 1; i--) {
      const msg = userMessages[i - 1] || "(unknown)";
      const summary = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
      const entry = entriesMap.get(i);
      let label = `${i}. "${summary}"`;
      if (entry) {
        const files = entry.entries.map((e) => e.path.split("/").pop()).join(", ");
        label += ` — ${entry.entries.length} file${entry.entries.length > 1 ? "s" : ""} (${files})`;
      }
      options.push({ label, value: String(i) });
    }
    options.push({ label: "Cancel", value: "_cancel_" });

    return (
      <Box flexDirection="column">
        <Text bold color="yellow">
          Select a turn to rollback to:
        </Text>
        <Select
          options={options}
          onChange={(v) => {
            if (v === "_cancel_") {
              onCancel?.();
            } else {
              setSelectedTurnIdx(Number(v));
              setStep("confirm");
            }
          }}
        />
        <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
      </Box>
    );
  }

  // Confirm step
  const turn = entriesByTurn.find((t) => t.turnIdx === selectedTurnIdx);
  const hasFiles = turn && turn.entries.length > 0;
  const msg = userMessages[selectedTurnIdx - 1] || "(unknown)";

  const scopeOptions = [
    { label: "Conversation", value: "conversation" },
  ];
  if (hasFiles) {
    scopeOptions.push({ label: "Conversation + code", value: "both" });
  }
  scopeOptions.push({ label: "Cancel", value: "cancel" });

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        Rollback to before turn {selectedTurnIdx}: "{msg.length > 50 ? msg.slice(0, 50) + "..." : msg}"
      </Text>
      {hasFiles && (
        <>
          <Text>Files to restore:</Text>
          {turn.entries.map((e) => (
            <Text key={e.path}>
              {"  "}- {e.path} ({e.op})
            </Text>
          ))}
        </>
      )}
      <Select
        options={scopeOptions}
        onChange={async (v) => {
          if (processing) return;
          if (v === "cancel") {
            onCancel?.();
            return;
          }
          if (!agent) {
            onCancel?.();
            return;
          }
          setProcessing(true);

          const { RollbackExecutor } = await import(
            "../../services/rollback-executor.js"
          );
          const executor = new RollbackExecutor();
          const journal = agent.getChangeJournal();

          try {
            let result;
            if (v === "both") {
              result = await executor.rollbackFilesAndConversation(
                journal,
                agent.getStore(),
                selectedTurnIdx,
              );
            } else {
              result = await executor.rollbackConversation(
                journal,
                agent.getStore(),
                selectedTurnIdx,
              );
            }

            const parts: string[] = [];
            if (v === "both") {
              if (result.filesRestored.length > 0) {
                parts.push(`restored ${result.filesRestored.length} file(s)`);
              }
              if (result.filesDeleted.length > 0) {
                parts.push(`deleted ${result.filesDeleted.length} file(s)`);
              }
            }
            parts.push("conversation rolled back");
            agent.getStore().addStatus({
              role: "status",
              content: `(Rollback: ${parts.join(", ")})`,
              timestamp: new Date(),
            });
          } catch (e) {
            agent.getStore().addStatus({
              role: "error",
              content: `(Rollback failed: ${(e as Error).message})`,
              timestamp: new Date(),
            });
          }

          onCancel?.();
        }}
      />
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
  { name: "undo", Component: UndoInput },
];

export function getInputComponent(
  name: string,
): React.ComponentType<InputComponentProps> {
  const found = inputComponents.find((c) => c.name === name);
  return found?.Component || ChatInput;
}
