import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTuiState, type TuiState } from "./state.js";
import type { PromptOption } from "../../tools/registry.js";

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
  const pendingPrompt = useTuiState((s) => s.pendingPrompt);

  if (!pendingPrompt) return null;

  if (pendingPrompt.multiSelect) {
    return <MultiPrompt prompt={pendingPrompt} />;
  }

  return <SinglePrompt prompt={pendingPrompt} />;
}

function SinglePrompt({
  prompt,
}: {
  prompt: NonNullable<TuiState["pendingPrompt"]>;
}) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      prompt.resolve("");
      useTuiState.setState({ pendingPrompt: null });
    } else if (key.return) {
      prompt.resolve(prompt.options[cursor].value);
      useTuiState.setState({ pendingPrompt: null });
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
}: {
  prompt: NonNullable<TuiState["pendingPrompt"]>;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());

  useInput((_input, key) => {
    if (key.escape) {
      prompt.resolve("");
      useTuiState.setState({ pendingPrompt: null });
    } else if (key.return) {
      const values = prompt.options
        .filter((o) => selected.has(o.value))
        .map((o) => o.value);
      prompt.resolve(values.join(", "));
      useTuiState.setState({ pendingPrompt: null });
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
