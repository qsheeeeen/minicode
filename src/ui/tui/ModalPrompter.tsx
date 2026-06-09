import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTuiStore, type TuiState } from "./store.js";
import type { PromptOption } from "../../utils/display.js";

function OptionList({
  options,
  cursor,
}: {
  options: PromptOption[];
  cursor: number;
}) {
  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Box key={o.value} flexDirection="column">
          <Box>
            <Text color="cyan" bold>
              {i === cursor ? "❯ " : "  "}
            </Text>
            <Text bold={i === cursor} inverse={i === cursor}>
              {o.label}
            </Text>
          </Box>
          {o.description && (
            <Box paddingLeft={2}>
              <Text dimColor>{o.description}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function MultiOptionList({
  options,
  cursor,
  selected,
}: {
  options: PromptOption[];
  cursor: number;
  selected: Set<string>;
}) {
  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Box key={o.value} flexDirection="column">
          <Box>
            <Text color="cyan" bold>
              {i === cursor ? "❯ " : "  "}
            </Text>
            <Text>{selected.has(o.value) ? "◉ " : "○ "}</Text>
            <Text bold={i === cursor}>{o.label}</Text>
          </Box>
          {o.description && (
            <Box paddingLeft={2}>
              <Text dimColor>{o.description}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

export function ModalPrompter() {
  const pendingPrompt = useTuiStore((s) => s.pendingPrompt);
  const dispatch = useTuiStore((s) => s.dispatch);

  if (!pendingPrompt) return null;

  if (pendingPrompt.multiSelect) {
    return <MultiPrompt prompt={pendingPrompt} dispatch={dispatch} />;
  }

  return <SinglePrompt prompt={pendingPrompt} dispatch={dispatch} />;
}

function SinglePrompt({
  prompt,
  dispatch,
}: {
  prompt: NonNullable<TuiState["pendingPrompt"]>;
  dispatch: (action: any) => void;
}) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      prompt.resolve("");
      dispatch({ type: "SET_PENDING_PROMPT", payload: null });
    } else if (key.return) {
      prompt.resolve(prompt.options[cursor].value);
      dispatch({ type: "SET_PENDING_PROMPT", payload: null });
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(prompt.options.length - 1, c + 1));
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginBottom={1}
    >
      <Text>{prompt.message}</Text>
      <Box flexDirection="column" marginTop={1}>
        <OptionList options={prompt.options} cursor={cursor} />
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}

function MultiPrompt({
  prompt,
  dispatch,
}: {
  prompt: NonNullable<TuiState["pendingPrompt"]>;
  dispatch: (action: any) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());

  useInput((_input, key) => {
    if (key.escape) {
      prompt.resolve("");
      dispatch({ type: "SET_PENDING_PROMPT", payload: null });
    } else if (key.return) {
      const values = prompt.options
        .filter((o) => selected.has(o.value))
        .map((o) => o.value);
      prompt.resolve(values.join(", "));
      dispatch({ type: "SET_PENDING_PROMPT", payload: null });
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(prompt.options.length - 1, c + 1));
    } else if (_input === " ") {
      const val = prompt.options[cursor].value;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(val)) next.delete(val);
        else next.add(val);
        return next;
      });
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginBottom={1}
    >
      <Text>{prompt.message}</Text>
      <Box flexDirection="column" marginTop={1}>
        <MultiOptionList
          options={prompt.options}
          cursor={cursor}
          selected={selected}
        />
        <Box marginTop={1}>
          <Text dimColor>Space select · Enter confirm · Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
