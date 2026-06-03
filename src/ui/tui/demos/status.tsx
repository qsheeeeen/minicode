/**
 * Standalone demo for Status component.
 * Run: bun run src/ui/tui/demos/status.tsx
 */
import { render, Box } from "ink";
import { TuiProvider } from "../store.js";
import { Status } from "../Status.js";

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <TuiProvider initialState={{ isLoading: true, pendingPrompt: null }}>
        <Status />
      </TuiProvider>
      <TuiProvider
        initialState={{
          isLoading: true,
          pendingPrompt: { message: "Pick one", options: [{ label: "A", value: "a" }], resolve: () => {} } as any,
        }}
      >
        <Status />
      </TuiProvider>
    </Box>
  );
}

render(<Demo />);
