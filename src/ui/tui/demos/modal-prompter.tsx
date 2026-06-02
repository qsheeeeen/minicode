/**
 * Standalone interactive demo for ModalPrompter.
 * Run: bun run src/ui/tui/demos/modal-prompter.tsx
 */
import React from "react";
import { render, Box, Text } from "ink";
import { TuiProvider } from "../store.js";
import { ModalPrompter } from "../ModalPrompter.js";

function Demo() {
  const state = {
    pendingPrompt: {
      message: "Which approach do you prefer?",
      options: [
        { label: "Approach A", value: "a", description: "Use a REST API with Express" },
        { label: "Approach B", value: "b", description: "Use GraphQL with Apollo" },
        { label: "Approach C", value: "c", description: "Use tRPC for end-to-end type safety" },
      ],
      multiSelect: false,
      resolve: (value: string) => {
        console.log(`\nSelected: ${value}`);
        process.exit(0);
      },
    },
  };

  return (
    <TuiProvider initialState={state as any}>
      <Box flexDirection="column">
        <Box paddingX={1} marginBottom={1}>
          <Text bold color="cyan">[ Demo: ModalPrompter — Single Select ]</Text>
        </Box>
        <ModalPrompter />
      </Box>
    </TuiProvider>
  );
}

render(<Demo />);
