// Standalone demo for Message component.
// Run: bun run src/ui/tui/demos/widgets/message.tsx
import { render, Box } from "ink";
import { Message } from "../../Message.js";
import { sampleMessages } from "../fixtures.js";

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      {sampleMessages.map((msg, i) => (
        <Message key={i} msg={msg} />
      ))}
    </Box>
  );
}

render(<Demo />);
