// Standalone demo for Header component.
// Run: bun run src/ui/tui/demos/header.tsx
import { render, Box } from "ink";
import { Header } from "../Header.js";

function Demo() {
  return (
    <Box flexDirection="column">
      <Header version="0.1.0" projectPath="/home/user/my-project" />
    </Box>
  );
}

render(<Demo />);
