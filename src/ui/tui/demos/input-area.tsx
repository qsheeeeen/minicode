/**
 * Standalone demo for InputArea component.
 * Run: bun run src/ui/tui/demos/input-area.tsx
 */
import { render, Box } from "ink";
import { TuiProvider } from "../store.js";
import { InputArea } from "../InputArea.js";

const agentRef = { current: { setEffort: () => {}, setModel: () => {}, getStore: () => ({ addStatus: () => {} }) } as any };
const loadingRef = { current: false };

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <TuiProvider initialState={{ input: { mode: "chat", value: "", props: {}, key: 0 }, isLoading: false, pendingPrompt: null }}>
        <InputArea agentRef={agentRef} handleSubmit={async (v) => { console.log(v); return true; }} loadingRef={loadingRef} />
      </TuiProvider>
    </Box>
  );
}

render(<Demo />);
