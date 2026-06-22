// Standalone demo for Help component.
// Run: bun run src/ui/tui/demos/widgets/help.tsx
import { render, Box } from "ink";
import { Help } from "../../Help.js";

function Demo() {
  return (
    <Box flexDirection="column">
      <Help />
    </Box>
  );
}

render(<Demo />);
