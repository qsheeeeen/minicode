// Composite demo showing all TUI components.
// Run: bun run src/ui/tui/demos/index.tsx
import { useState } from "react";
import { render, Box, useInput } from "ink";
import { useTuiStore } from "../store.js";
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
  {
    role: "user" as const,
    content:
      "Help me set up Express with TypeScript and show a markdown example.",
  },
  {
    role: "thinking" as const,
    content:
      "The user wants an Express scaffolding and a markdown demo. I'll start by initializing the project, reading the entry point, and modifying the port.",
  },
  {
    role: "tool" as const,
    name: "Shell",
    input: { command: "npm init -y" },
    output: "Wrote to package.json",
    slotId: "s1",
  },
  {
    role: "tool" as const,
    name: "Read",
    input: { path: "src/index.ts" },
    output: "10 lines, 256 chars",
    slotId: "s2",
  },
  {
    role: "tool" as const,
    name: "Edit",
    input: { path: "src/app.ts" },
    output:
      "--- src/app.ts\n+++ src/app.ts\n  3 - const port = 3000;\n  3 + const port = 8080;",
    slotId: "s3",
  },
  {
    role: "thinking" as const,
    content:
      "The basic setup is done. Now I should generate a comprehensive showcase of supported markdown features like tables, code blocks, and blockquotes to demonstrate the new `ink-markdown-es` renderer.",
  },
  {
    role: "text" as const,
    content:
      "Done! Project is scaffolded. Here is a comprehensive overview of the Markdown features we now support in the terminal:\n\n# Markdown Feature Showcase\n\nThis paragraph demonstrates **bold text**, *italic text*, ~~strikethrough~~, and `inline code`.\n\n## 1. Lists & Hierarchy\n- Unordered item 1\n  - Nested unordered item\n- Unordered item 2\n\n1. Ordered item 1\n2. Ordered item 2\n\n## 2. Blockquotes\n> \"The terminal is the developer's canvas.\"\n> \n> — It can span multiple lines and contain other elements.\n\n## 3. Code Blocks\nHere is some syntax-highlighted TypeScript:\n\n```typescript\ninterface User {\n  name: string;\n  role: 'admin' | 'user';\n}\n\nconst greet = (user: User) => console.log(`Hello ${user.name}`);\n```\n\n## 4. Tables\n| Framework | Language | Status |\n|:----------|:---------|:-------|\n| Express   | TS / JS  | Active |\n| FastAPI   | Python   | Active |\n",
  },
  {
    role: "status" as const,
    content: "Project scaffolded",
    timestamp: new Date(),
  },
];

const agentSessions = [
  {
    id: "1",
    type: "main" as const,
    agent: {} as any,
    context: {} as any,
    status: "running" as const,
    tokenCount: 12000,
    toolCalls: 5,
  },
  {
    id: "2",
    type: "sub" as const,
    agent: {} as any,
    context: {} as any,
    status: "completed" as const,
    task: "Install dependencies",
    tokenCount: 3200,
    toolCalls: 2,
  },
];

const agentRef = {
  current: {
    model: {
      getProvider: () => "anthropic",
      getDisplayName: () => "claude-sonnet-4-5",
      getContextLength: () => 200000,
      setEffort: () => {},
    },
  } as any,
};

const receiptData = {
  projectName: "express-ts-app",
  startTime: Date.now() - 1000 * 60 * 15,
  sessionCount: 2,
  sessionNames: ["session-1231231123123", "session-4564564456456"],
  models: [
    {
      name: "claude-sonnet-4-5",
      input: 28500,
      output: 6200,
      cacheMiss: 8000,
      cacheHit: 20000,
      total: 34700,
    },
  ],
  totalTokens: 34700,
};

const inputModes = ["chat", "effort", "session"] as const;

function Demo() {
  const [inputIdx, setInputIdx] = useState(0);
  useInput((_input, key) => {
    if (key.shift && key.tab) setInputIdx((i) => (i + 1) % inputModes.length);
  });

  const mode = inputModes[inputIdx];

  useTuiStore.setState({
    messages,
    agentSessions,
    activeAgentId: "1",
    tokenCount: 34700,
    currentSession: "session-1231231123123",
    isLoading: true,
    permissionMode: "manual" as const,
    status: "",
    pendingPrompt: null,
    input: { mode, value: "", props: {}, key: 0 },
  });

  return (
    <Box flexDirection="column">
      <Header version="0.1.0" projectPath="/home/user/express-ts-app" />
      <MessageList />
      <Status />
      {mode === "chat" ? (
        <InputArea
          agentRef={agentRef}
          handleSubmit={async (v) => {
            console.log(v);
            return true;
          }}
          loadingRef={{ current: false }}
        />
      ) : mode === "effort" ? (
        <Box
          borderStyle="single"
          borderLeft={false}
          borderRight={false}
          paddingX={1}
        >
          <EffortSelectInput
            onExecute={(v) => console.log(v)}
            onCancel={() => setInputIdx(0)}
          />
        </Box>
      ) : (
        <Box
          borderStyle="single"
          borderLeft={false}
          borderRight={false}
          paddingX={1}
        >
          <SessionListInput
            sessions={[
              { name: "session-1231231123123" },
              { name: "session-4564564456456" },
            ]}
            onExecute={(v) => console.log(v)}
            onCancel={() => setInputIdx(0)}
          />
        </Box>
      )}
      <SubAgentBar />
      <Panel agentRef={agentRef} />
      <Help />
      <Receipt data={receiptData} onDismiss={() => {}} />
    </Box>
  );
}

render(<Demo />);
