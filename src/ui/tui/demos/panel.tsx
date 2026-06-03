/**
 * Standalone demo for Panel component.
 * Run: bun run src/ui/tui/demos/panel.tsx
 */
import { render, Box } from "ink";
import { TuiProvider } from "../store.js";
import { Panel } from "../Panel.js";

function mkAgent(model: string, provider: string, ctx: number) {
  return { current: { getModelProvider: () => provider, getModelName: () => model, getContextLength: () => ctx } as any };
}

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <TuiProvider initialState={{ tokenCount: 24000, currentSession: "debug-auth", permissionMode: "manual", status: "" }}>
        <Panel agentRef={mkAgent("claude-sonnet-4-5", "anthropic", 200000)} promptFiles={["AGENTS.md"]} />
      </TuiProvider>
      <TuiProvider initialState={{ tokenCount: 110000, currentSession: "refactor-db", permissionMode: "yolo", status: "" }}>
        <Panel agentRef={mkAgent("claude-opus-4-7", "anthropic", 200000)} />
      </TuiProvider>
      <TuiProvider initialState={{ tokenCount: 178000, currentSession: "feature-x", permissionMode: "auto", status: "Compressing..." }}>
        <Panel agentRef={mkAgent("gpt-4o", "openai", 200000)} />
      </TuiProvider>
    </Box>
  );
}

render(<Demo />);
