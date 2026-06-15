// Standalone demo for InputArea component.
// Run: bun run src/ui/tui/demos/input-area.tsx
import { render, Box } from "ink";
import { useTuiState } from "../state.js";
import { InputArea } from "../InputArea.js";

const agentRef = {
  current: {
    setEffort: () => {},
    setModel: () => {},
    getStore: () => ({ addStatus: () => {} }),
  } as any,
};
const loadingRef = { current: false };

useTuiState.setState({
  input: { mode: "chat", value: "", props: {}, key: 0 },
  isLoading: false,
  pendingPrompt: null,
});
render(
  <Box flexDirection="column" padding={1}>
    <InputArea
      agentRef={agentRef}
      handleSubmit={async (v) => {
        console.log(v);
        return true;
      }}
      loadingRef={loadingRef}
      config={{} as any}
      modelSwitchService={{ switchAgentModel: async () => null } as any}
    />
  </Box>,
);
