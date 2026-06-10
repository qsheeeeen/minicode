// Standalone demo for Message component.
// Run: bun run src/ui/tui/demos/message.tsx
import { render, Box } from "ink";
import { Message } from "../Message.js";

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <Message
        msg={{ role: "user", content: "Can you help me fix the login bug?" }}
      />
      <Message
        msg={{
          role: "text",
          content:
            "Sure! Let me look at the authentication flow. I found the issue in `auth.ts`.",
        }}
      />
      <Message
        msg={{
          role: "text",
          content: "Writing the fix now...",
          isStreaming: true,
        }}
      />
      <Message
        msg={{
          role: "thinking",
          content:
            "The user is reporting a login bug. I should check the auth middleware first.",
        }}
      />
      <Message
        msg={{
          role: "tool",
          name: "Read",
          input: { path: "src/auth.ts" },
          output: "export function validate(token: string) {\n  // ...\n}",
          slotId: "s1",
        }}
      />
      <Message
        msg={{
          role: "status",
          content: "Session loaded successfully",
          timestamp: new Date(),
        }}
      />
      <Message
        msg={{
          role: "status",
          content: "",
          timestamp: new Date(),
          toolDisplay: {
            name: "Edit",
            input: { path: "src/auth.ts" },
            output:
              "--- src/auth.ts\n+++ src/auth.ts\n  5 - return null;\n  5 + return session;",
          },
        }}
      />
      <Message
        msg={{
          role: "error",
          content: "Failed to connect to database: ECONNREFUSED",
          timestamp: new Date(),
        }}
      />
    </Box>
  );
}

render(<Demo />);
