// Scene: sub-agent lifecycle — main delegates, sub-agent registers/progresses/completes.
// Each agent has its own conversation; press ↑/↓ to switch into that agent's view
// (MessageList shows the focused agent's messages, SubAgentBar tracks focus).
// Run: bun run src/ui/tui/demos/scenes/subagent.tsx
import { useEffect, useRef } from "react";
import { render, Box, useInput } from "ink";
import { useTuiState } from "../../state.js";
import { MessageList } from "../../MessageList.js";
import { SubAgentBar } from "../../SubAgentBar.js";
import type { DisplayMessage } from "../../../display.js";
import type { AgentSession } from "../../../../services/agent-registry.js";

const main = (tokenCount: number, toolCalls: number): AgentSession => ({
  id: "1",
  type: "main",
  context: {} as any,
  status: "running",
  tokenCount,
  toolCalls,
});
const sub = (
  status: AgentSession["status"],
  tokenCount: number,
  toolCalls: number,
): AgentSession => ({
  id: "2",
  type: "sub",
  context: {} as any,
  status,
  task: "Review auth files for security issues",
  tokenCount,
  toolCalls,
});

// The sub-agent's own conversation (what it "sees" while working the delegated task).
const subMessages: DisplayMessage[] = [
  { role: "user", content: "Review auth files for security issues" },
  {
    role: "thinking",
    content: "Scanning auth.ts for vulnerabilities...",
  },
  {
    role: "tool",
    name: "Read",
    input: { path: "src/auth.ts" },
    output: "export function validate(token) { ... }",
    slotId: "s1",
  },
  {
    role: "tool",
    name: "Grep",
    input: { pattern: "password", path: "src" },
    output: "src/auth.ts:12:const password = 'hunter2'",
    slotId: "s2",
  },
  {
    role: "text",
    content:
      "Found 3 issues: hardcoded secret, no rate limit, plain-text password.",
  },
];

function Scene() {
  // Main conversation grows over time via the script below.
  const mainMsgs = useRef<DisplayMessage[]>([
    { role: "user", content: "Audit the auth module." },
  ]);

  // Switch into an agent's conversation: MessageList shows that agent's messages.
  const show = (id: string) => {
    useTuiState.setState({
      activeAgentId: id,
      messages: id === "2" ? subMessages : mainMsgs.current,
    });
  };

  // ↑/↓ switches to that agent's conversation.
  useInput((_input, key) => {
    const { agentSessions, activeAgentId } = useTuiState.getState();
    if (agentSessions.length === 0) return;
    const ids = agentSessions.map((s) => s.id);
    const idx = ids.indexOf(activeAgentId);
    let next = idx;
    if (key.upArrow) next = (idx - 1 + ids.length) % ids.length;
    else if (key.downArrow) next = (idx + 1) % ids.length;
    else return;
    show(ids[next]);
  });

  useEffect(() => {
    useTuiState.setState({ agentSessions: [main(500, 1)], isLoading: true });
    show("1");
    const steps = [
      setTimeout(() => {
        mainMsgs.current = [
          ...mainMsgs.current,
          {
            role: "tool",
            name: "SubAgent",
            input: { task: "Review auth files for security issues" },
            output: "Delegated to sub-agent #2",
            slotId: "s1",
          },
        ];
        useTuiState.setState({
          agentSessions: [main(800, 2), sub("running", 200, 1)],
        });
        show(useTuiState.getState().activeAgentId);
      }, 1000),
      setTimeout(() => {
        useTuiState.setState({
          agentSessions: [main(1200, 3), sub("running", 1500, 4)],
        });
      }, 2500),
      setTimeout(() => {
        mainMsgs.current = [
          ...mainMsgs.current,
          {
            role: "text",
            content: "Sub-agent found 3 issues in auth.ts. Applying fixes...",
          },
        ];
        useTuiState.setState({
          agentSessions: [main(1500, 4), sub("completed", 2100, 5)],
        });
        show(useTuiState.getState().activeAgentId);
      }, 4000),
    ];
    return () => steps.forEach(clearTimeout);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <MessageList />
      <SubAgentBar />
    </Box>
  );
}

render(<Scene />);
