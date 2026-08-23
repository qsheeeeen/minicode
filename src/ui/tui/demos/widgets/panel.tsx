// Standalone demo for Panel component.
// Run: bun run src/ui/tui/demos/widgets/panel.tsx
import { render, Box } from "ink";
import { Model } from "../../../../llm/model.js";
import { useTuiState } from "../../state.js";
import { Panel } from "../../Panel.js";

useTuiState.setState({
  tokenCount: 24000,
  cacheHitRatio: null, // no cache data yet — ratio hidden
  currentSession: "debug-auth",
  permissionMode: "manual",
});
render(
  <Box flexDirection="column" padding={1}>
    <Panel
      model={new Model("claude-sonnet-4-5", "anthropic", 200000)}
      promptFiles={["AGENTS.md"]}
    />
  </Box>,
);
useTuiState.setState({
  tokenCount: 110000,
  cacheHitRatio: 0.87,
  currentSession: "refactor-db",
  permissionMode: "yolo",
});
render(<Panel model={new Model("claude-opus-4-7", "anthropic", 200000)} />);
useTuiState.setState({
  tokenCount: 178000,
  cacheHitRatio: 0.42,
  currentSession: "feature-x",
  permissionMode: "auto",
});
render(<Panel model={new Model("gpt-4o", "openai", 200000)} />);
