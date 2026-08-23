// Standalone demo for all input components.
// Run: bun run src/ui/tui/demos/widgets/inputs.tsx
import { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import {
  ChatInput,
  EffortSelectInput,
  SessionListInput,
  ModelSelectInput,
  UndoInput,
  ForkInput,
} from "../../inputs.js";

const demos = ["chat", "effort", "session", "model", "undo", "fork"] as const;

function Demo() {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => {
    if (key.shift && key.tab) setIdx((i) => (i + 1) % demos.length);
  });

  const current = demos[idx];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{current}</Text>
      {current === "chat" && (
        <ChatInput
          value=""
          onChange={() => {}}
          onSubmit={(v) => console.log(v)}
          inputKey={0}
        />
      )}
      {current === "effort" && (
        <EffortSelectInput
          onExecute={(v) => console.log(v)}
          onCancel={() => {}}
        />
      )}
      {current === "session" && (
        <SessionListInput
          sessions={[
            { name: "debug-auth" },
            { name: "refactor-db" },
            { name: "feature-login" },
          ]}
          onExecute={(v) => console.log(v)}
          onCancel={() => {}}
        />
      )}
      {current === "model" && (
        <ModelSelectInput
          providers={
            {
              anthropic: {
                apiKey: "sk-...",
                models: { "claude-sonnet-4-5": {}, "claude-haiku-4-5": {} },
              },
            } as any
          }
          tiers={{
            pro: "claude-sonnet-4-5@anthropic",
            flash: "claude-haiku-4-5@anthropic",
          }}
          activeTier="pro"
          onExecute={(v) => console.log(v)}
          onCancel={() => {}}
        />
      )}
      {current === "undo" && (
        <UndoInput
          totalUserMessages={3}
          userMessages={["Fix login bug", "Add validation", "Write tests"]}
          messageIds={["msg-1", "msg-2", "msg-3"]}
          entriesByUserMessage={[
            {
              userMessageId: "msg-1",
              entries: [
                {
                  userMessageId: "msg-1",
                  path: "src/auth.ts",
                  op: "edit",
                  beforeExists: true,
                  ranges: [{ start: 0, oldText: "old", newText: "new" }],
                  ts: Date.now(),
                },
              ],
            },
          ]}
          onExecute={(v) => console.log(v)}
          onCancel={() => {}}
        />
      )}
      {current === "fork" && (
        <ForkInput
          userMessages={["Fix login bug", "Add validation", "Write tests"]}
          messageIds={["msg-1", "msg-2", "msg-3"]}
          onExecute={(v) => console.log(v)}
          onCancel={() => {}}
        />
      )}
    </Box>
  );
}

render(<Demo />);
