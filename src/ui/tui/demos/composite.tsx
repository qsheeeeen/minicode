// Composite demo showing all TUI components.
// Run: bun run src/ui/tui/demos/composite.tsx
import { useState } from "react";
import { render, Box, useInput } from "ink";
import { Model } from "../../../llm/model.js";
import { CommandRegistry } from "../../commands/registry.js";
import { createDefaultSkillRegistry } from "../../../skills/index.js";
import { useTuiState } from "../state.js";
import { Header } from "../Header.js";
import { Help } from "../Help.js";
import { Status } from "../Status.js";
import { Panel } from "../Panel.js";
import { Receipt } from "../Receipt.js";
import { SubAgentBar } from "../SubAgentBar.js";
import { MessageList } from "../MessageList.js";
import { InputArea } from "../InputArea.js";
import { EffortSelectInput, SessionListInput } from "../inputs.js";
import { sampleMessages, sampleSessions } from "./fixtures.js";

const model = new Model("claude-sonnet-4-5", "anthropic", 200000);

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

  useTuiState.setState({
    messages: sampleMessages,
    agentSessions: sampleSessions,
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
          model={model}
          handleSubmit={async (v) => {
            console.log(v);
            return true;
          }}
          loadingRef={{ current: false }}
          config={{} as any}
          modelSwitchService={{ switchAgentModel: async () => null } as any}
          sessionManager={{ reportStatus: () => {} } as any}
          commandRegistry={new CommandRegistry()}
          skillRegistry={createDefaultSkillRegistry()}
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
      <Panel model={model} />
      <Help />
      <Receipt data={receiptData} onDismiss={() => {}} />
    </Box>
  );
}

render(<Demo />);
