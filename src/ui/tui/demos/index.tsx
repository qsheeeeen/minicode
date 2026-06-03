/**
 * Composite demo showing all TUI components.
 * Run: bun run src/ui/tui/demos/index.tsx
 */
import { useState } from "react";
import { render, Box, useInput } from "ink";
import { TuiProvider } from "../store.js";
import { Header } from "../Header.js";
import { Help } from "../Help.js";
import { Status } from "../Status.js";
import { Panel } from "../Panel.js";
import { Receipt } from "../Receipt.js";
import { SubAgentBar } from "../SubAgentBar.js";
import { MessageList } from "../MessageList.js";
import { InputArea } from "../InputArea.js";
import { EffortSelectInput, SessionListInput } from "../inputs.js";

const messages = [
  { role: "user" as const, content: "Help me set up Express with TypeScript" },
  { role: "text" as const, content: "I'll scaffold the project for you." },
  { role: "tool" as const, name: "Bash", input: { command: "npm init -y" }, output: "Wrote to package.json", slotId: "s1" },
  { role: "tool" as const, name: "Read", input: { path: "src/index.ts" }, output: "10 lines, 256 chars", slotId: "s2" },
  { role: "tool" as const, name: "Edit", input: { path: "src/app.ts" }, output: "--- src/app.ts\n+++ src/app.ts\n  3 - const port = 3000;\n  3 + const port = 8080;", slotId: "s3" },
  { role: "status" as const, content: "Project scaffolded", timestamp: new Date() },
  { role: "text" as const, content: "Done! Run `npm install` to get started." },
];

const agentSessions = [
  { id: "1", type: "main" as const, agent: {} as any, status: "running" as const, tokenCount: 12000, toolCalls: 5 },
  { id: "2", type: "sub" as const, agent: {} as any, status: "completed" as const, task: "Install dependencies", tokenCount: 3200, toolCalls: 2 },
];

const agentRef = { current: { getModelProvider: () => "anthropic", getModelName: () => "claude-sonnet-4-5", getContextLength: () => 200000, setEffort: () => {}, setModel: () => {}, getStore: () => ({ addStatus: () => {} }) } as any };

const receiptData = {
  projectName: "express-ts-app", startTime: Date.now() - 1000 * 60 * 15, sessionCount: 2, sessionNames: ["setup", "add-auth"],
  models: [{ name: "claude-sonnet-4-5", inputTokens: 28500, outputTokens: 6200, cacheCreation: 8000, cacheRead: 20000, total: 34700 }],
  totalTokens: 34700,
};

const inputModes = ["chat", "effort", "session"] as const;

function Demo() {
  const [inputIdx, setInputIdx] = useState(0);
  const [showReceipt, setShowReceipt] = useState(false);
  useInput((_input, key) => {
    if (key.shift && key.tab) setInputIdx((i) => (i + 1) % inputModes.length);
    if (key.ctrl && _input === "r") setShowReceipt((s) => !s);
  });

  if (showReceipt) return <Receipt data={receiptData} onDismiss={() => setShowReceipt(false)} />;

  const mode = inputModes[inputIdx];

  return (
    <Box flexDirection="column">
      <Header version="0.1.0" projectPath="/home/user/express-ts-app" />
      <TuiProvider initialState={{ messages, agentSessions, activeAgentId: "1", tokenCount: 34700, currentSession: "setup", isLoading: true, permissionMode: "manual" as const, status: "", pendingPrompt: null, input: { mode, value: "", props: {}, key: 0 } }}>
        <MessageList />
        <Status />
        {mode === "chat" ? (
          <InputArea agentRef={agentRef} handleSubmit={async (v) => { console.log(v); return true; }} loadingRef={{ current: false }} />
        ) : mode === "effort" ? (
          <Box borderStyle="single" borderLeft={false} borderRight={false} paddingX={1}>
            <EffortSelectInput onExecute={(v) => console.log(v)} onCancel={() => setInputIdx(0)} />
          </Box>
        ) : (
          <Box borderStyle="single" borderLeft={false} borderRight={false} paddingX={1}>
            <SessionListInput sessions={[{ name: "setup" }, { name: "add-auth" }]} onExecute={(v) => console.log(v)} onCancel={() => setInputIdx(0)} />
          </Box>
        )}
        <SubAgentBar />
        <Panel agentRef={agentRef} />
      </TuiProvider>
      <Help />
    </Box>
  );
}

render(<Demo />);
