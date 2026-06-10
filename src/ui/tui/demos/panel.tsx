// Standalone demo for Panel component.
// Run: bun run src/ui/tui/demos/panel.tsx
import { render, Box } from "ink";
import { useTuiStore } from "../store.js";
import { Panel } from "../Panel.js";

function mkAgent(model: string, provider: string, ctx: number) {
  return {
    current: {
      getModelProvider: () => provider,
      getModelName: () => model,
      getContextLength: () => ctx,
    } as any,
  };
}

useTuiStore.setState({
  tokenCount: 24000,
  currentSession: "debug-auth",
  permissionMode: "manual",
  status: "",
});
render(
  <Box flexDirection="column" padding={1}>
    <Panel
      agentRef={mkAgent("claude-sonnet-4-5", "anthropic", 200000)}
      promptFiles={["AGENTS.md"]}
    />
  </Box>,
);
useTuiStore.setState({
  tokenCount: 110000,
  currentSession: "refactor-db",
  permissionMode: "yolo",
  status: "",
});
render(
  <Panel agentRef={mkAgent("claude-opus-4-7", "anthropic", 200000)} />,
);
useTuiStore.setState({
  tokenCount: 178000,
  currentSession: "feature-x",
  permissionMode: "auto",
  status: "Compressing...",
});
render(
  <Panel agentRef={mkAgent("gpt-4o", "openai", 200000)} />,
);
