// Standalone demo for ToolDisplay component.
// Run: bun run src/ui/tui/demos/tool-display.tsx
import React from "react";
import { render, Box, Text } from "ink";
import { ToolDisplay } from "../tool-display.js";

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <ToolDisplay
        name="Read"
        input={{ path: "src/index.ts", offset: 10, limit: 20 }}
        output={"line 1\nline 2\nline 3\n..."}
      />
      <ToolDisplay
        name="Write"
        input={{
          path: "src/new-file.ts",
          content: "export const x = 1;\nexport const y = 2;",
        }}
        output="Wrote 2 lines to src/new-file.ts"
      />
      <ToolDisplay
        name="Edit"
        input={{ path: "src/utils.ts" }}
        output={
          "--- src/utils.ts\n+++ src/utils.ts\n  1 - const x = 1;\n  1 + const x = 42;\n  2   const y = 2;"
        }
      />
      <ToolDisplay
        name="Shell"
        input={{ command: "bun test" }}
        output={"✓ 12 tests passed, 0 failed"}
      />
      <ToolDisplay
        name="SubAgent"
        input={{
          task: "Find all TypeScript files that export a default function",
        }}
        output="Found 5 files."
      />
      <ToolDisplay
        name="LoadSkill"
        input={{ name: "code-review" }}
        output="Loaded"
      />
      <ToolDisplay
        name="AskUser"
        input={{ question: "Which database should we use?" }}
      />
      <ToolDisplay name="SetModel" input={{ tier: "flash" }} />
    </Box>
  );
}

render(<Demo />);
