// Standalone demo for ModalPrompter.
// Run: bun run src/ui/tui/demos/modal-prompter.tsx
import { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import { useTuiState } from "../state.js";
import { ModalPrompter } from "../ModalPrompter.js";

function Demo() {
  const [multi, setMulti] = useState(false);
  useInput((_input, key) => {
    if (key.shift && key.tab) setMulti((m) => !m);
  });

  const state = {
    pendingPrompt: {
      message: multi
        ? "Which features should be enabled?"
        : "Which approach do you prefer?",
      options: multi
        ? [
            {
              label: "Authentication",
              value: "auth",
              description: "JWT-based user auth",
            },
            {
              label: "Rate Limiting",
              value: "rate-limit",
              description: "Request throttling",
            },
            {
              label: "Caching",
              value: "cache",
              description: "Redis-based response caching",
            },
          ]
        : [
            {
              label: "Approach A",
              value: "a",
              description: "Use a REST API with Express",
            },
            {
              label: "Approach B",
              value: "b",
              description: "Use GraphQL with Apollo",
            },
            {
              label: "Approach C",
              value: "c",
              description: "Use tRPC for end-to-end type safety",
            },
          ],
      multiSelect: multi,
      resolve: (value: string) => {
        console.log(`\nSelected: ${value}`);
        process.exit(0);
      },
    },
  };

  useTuiState.setState(state as any);
  return (
    <Box flexDirection="column">
      <Text bold>{multi ? "multi" : "single"}</Text>
      <ModalPrompter />
    </Box>
  );
}

render(<Demo />);
