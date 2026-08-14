import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import type { ProviderConfig } from "../../config.js";
import type { ChangeEntry } from "../../services/change-journal.js";
import type { ChangeJournal } from "../../services/change-journal.js";
import type { LLMContext } from "../../llm/context.js";
import type { StatusReporter } from "../../services/session-manager.js";

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
  const options = Object.keys(models).map((k) => ({
    label: models[k]?.name || k,
    value: `${editTier}:${k}@${selectedProvider}`,
  }));

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

// Undo: two-step rollback UI (select user message → select scope)
export function UndoInput({
  onExecute: _onExecute,
  onCancel,
  entriesByUserMessage = [],
  userMessages = [],
  totalUserMessages = 0,
  changeJournal,
  context,
  reportStatus,
}: InputComponentProps & {
  entriesByUserMessage?: Array<{
    userMessageOrdinal: number;
    entries: ChangeEntry[];
  }>;
  userMessages?: string[];
  totalUserMessages?: number;
  changeJournal?: ChangeJournal;
  context?: LLMContext;
  reportStatus?: StatusReporter;
}) {
  const [step, setStep] = useState<"list" | "confirm">("list");
  const [selectedUserMessageOrdinal, setSelectedUserMessageOrdinal] =
    useState(0);
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
      entriesByUserMessage.map((e) => [e.userMessageOrdinal, e]),
    );
    const options = [];
    for (let i = userMessageCount; i >= 1; i--) {
      const msg = userMessages[i - 1] || "(unknown)";
      const summary = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
      const entry = entriesMap.get(i);
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
    (e) => e.userMessageOrdinal === selectedUserMessageOrdinal,
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
        onChange={async (v) => {
          if (processing) return;
          if (v === "cancel") {
            onCancel?.();
            return;
          }
          if (!changeJournal || !context) {
            onCancel?.();
            return;
          }
          setProcessing(true);

          const { RollbackExecutor } =
            await import("../../services/rollback-executor.js");
          const executor = new RollbackExecutor();

          const outcome =
            v === "both"
              ? await executor.rollbackFilesAndConversation(
                  changeJournal,
                  context,
                  selectedUserMessageOrdinal,
                )
              : await executor.rollbackConversation(
                  changeJournal,
                  context,
                  selectedUserMessageOrdinal,
                );

          if (!outcome.ok) {
            const { filesRestored, filesDeleted } = outcome.partial;
            const partialNote =
              filesRestored.length + filesDeleted.length > 0
                ? ` (${filesRestored.length} restored, ${filesDeleted.length} deleted before failure)`
                : "";
            reportStatus?.({
              role: "error",
              content: `(Rollback failed: ${outcome.reason}${partialNote})`,
              timestamp: new Date(),
            });
          } else {
            const result = outcome.result;
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
            reportStatus?.({
              role: "status",
              content: `(Rollback: ${parts.join(", ")})`,
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

// Input component registry
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
