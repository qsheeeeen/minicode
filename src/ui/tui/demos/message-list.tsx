// Standalone demo for MessageList component.
// Run: bun run src/ui/tui/demos/message-list.tsx
import { render, Box } from "ink";
import { TuiProvider } from "../store.js";
import { MessageList } from "../MessageList.js";

const messages = [
  {
    role: "user" as const,
    content: "How do I add authentication to my Express app?",
  },
  {
    role: "text" as const,
    content:
      "I'll help you add authentication. Let me first check your current setup.",
  },
  {
    role: "tool" as const,
    name: "Read",
    input: { path: "package.json" },
    output: '{\n  "dependencies": {\n    "express": "^4.18.0"\n  }\n}',
    slotId: "s1",
  },
  {
    role: "thinking" as const,
    content: "The user has a basic Express app. I should suggest JWT.",
  },
  {
    role: "text" as const,
    content:
      "You have a basic Express app. I recommend using JWT for authentication.",
  },
  {
    role: "tool" as const,
    name: "Write",
    input: { path: "src/middleware/auth.ts", content: "..." },
    output: "Wrote 5 lines",
    slotId: "s2",
  },
  {
    role: "status" as const,
    content: "Created auth middleware",
    timestamp: new Date(),
  },
  {
    role: "error" as const,
    content: "npm ERR! peer dependency conflict",
    timestamp: new Date(),
  },
];

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <TuiProvider initialState={{ messages }}>
        <MessageList />
      </TuiProvider>
    </Box>
  );
}

render(<Demo />);
