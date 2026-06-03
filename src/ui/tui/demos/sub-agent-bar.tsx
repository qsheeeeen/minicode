/**
 * Standalone demo for SubAgentBar component.
 * Run: bun run src/ui/tui/demos/sub-agent-bar.tsx
 */
import { render, Box } from "ink";
import { TuiProvider } from "../store.js";
import { SubAgentBar } from "../SubAgentBar.js";

const agentSessions = [
  { id: "1", type: "main" as const, agent: {} as any, status: "running" as const, tokenCount: 15000, toolCalls: 8 },
  { id: "2", type: "sub" as const, agent: {} as any, status: "completed" as const, task: "Find all auth-related files and review them for security issues", tokenCount: 3200, toolCalls: 4 },
  { id: "3", type: "sub" as const, agent: {} as any, status: "error" as const, task: "Run the test suite and report failures", tokenCount: 1100, toolCalls: 2 },
  { id: "4", type: "sub" as const, agent: {} as any, status: "idle" as const, task: "Refactor the database layer" },
];

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <TuiProvider initialState={{ agentSessions, activeAgentId: "1" }}>
        <SubAgentBar />
      </TuiProvider>
    </Box>
  );
}

render(<Demo />);
