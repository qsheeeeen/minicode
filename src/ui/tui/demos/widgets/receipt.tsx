// Standalone demo for Receipt component.
// Run: bun run src/ui/tui/demos/widgets/receipt.tsx
import { render, Box } from "ink";
import { Receipt } from "../../Receipt.js";

const receiptData = {
  projectName: "my-awesome-app",
  startTime: Date.now() - 1000 * 60 * 23,
  sessionCount: 3,
  sessionNames: ["session-1", "debug-auth", "refactor-db"],
  models: [
    {
      name: "claude-sonnet-4-5",
      input: 45230,
      output: 8120,
      cacheMiss: 12000,
      cacheHit: 33000,
      total: 53350,
    },
    {
      name: "claude-haiku-4-5",
      input: 12000,
      output: 3400,
      cacheMiss: 0,
      cacheHit: 8000,
      total: 15400,
    },
  ],
  totalTokens: 68750,
};

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <Receipt data={receiptData} onDismiss={() => {}} />
    </Box>
  );
}

render(<Demo />);
