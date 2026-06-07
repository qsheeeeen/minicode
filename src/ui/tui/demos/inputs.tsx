// Standalone demo for all input components.
// Run: bun run src/ui/tui/demos/inputs.tsx
import React, { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import { ChatInput, EffortSelectInput, SessionListInput, ModelSelectInput, UndoInput } from "../inputs.js";

const demos = ["chat", "effort", "session", "model", "undo"] as const;

function Demo() {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => { if (key.shift && key.tab) setIdx((i) => (i + 1) % demos.length); });

  const current = demos[idx];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{current}</Text>
      {current === "chat" && <ChatInput value="" onChange={() => {}} onSubmit={(v) => console.log(v)} inputKey={0} />}
      {current === "effort" && <EffortSelectInput onExecute={(v) => console.log(v)} onCancel={() => {}} />}
      {current === "session" && <SessionListInput sessions={[{ name: "debug-auth" }, { name: "refactor-db" }, { name: "feature-login" }]} onExecute={(v) => console.log(v)} onCancel={() => {}} />}
      {current === "model" && <ModelSelectInput providers={{ anthropic: { apiKey: "sk-...", models: { "claude-sonnet-4-5": {}, "claude-haiku-4-5": {} } } } as any} tiers={{ "pro": "claude-sonnet-4-5@anthropic", "flash": "claude-haiku-4-5@anthropic" }} onExecute={(v) => console.log(v)} onCancel={() => {}} />}
      {current === "undo" && <UndoInput totalTurns={3} userMessages={["Fix login bug", "Add validation", "Write tests"]} entriesByTurn={[{ turnIdx: 1, entries: [{ path: "src/auth.ts", op: "edit", before: "..." } as any] }]} onExecute={(v) => console.log(v)} onCancel={() => {}} />}
    </Box>
  );
}

render(<Demo />);
