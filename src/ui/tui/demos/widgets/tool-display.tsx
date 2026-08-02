// Standalone demo for ToolDisplay component.
// Run: bun run src/ui/tui/demos/widgets/tool-display.tsx
import { render, Box } from "ink";
import { ToolDisplay } from "../../tool-display.js";

function Demo() {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <ToolDisplay
          name="Read"
          input={{ path: "src/index.ts", offset: 10, limit: 20 }}
          output={"line 1\nline 2\nline 3\n..."}
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="Write"
          input={{
            path: "src/new-file.ts",
            content: "export const x = 1;\nexport const y = 2;",
          }}
          output="Wrote 2 lines to src/new-file.ts"
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="Edit"
          input={{ path: "src/utils.ts", replaceAll: true }}
          output={
            "--- src/utils.ts\n+++ src/utils.ts\n  1 - const x = 1;\n  1 + const x = 42;\n  2   const y = 2;"
          }
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="Grep"
          input={{
            pattern: "TODO",
            path: "src",
            recursive: false,
            ignore_case: true,
            include: "*.ts",
          }}
          output={"src/a.ts:1:TODO fix this\nsrc/b.ts:5:TODO refactor"}
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="Shell"
          input={{ command: "bun test", timeout: 30 }}
          output={"✓ 12 tests passed, 0 failed"}
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="SubAgent"
          input={{
            task: "Find all TypeScript files that export a default function",
            tier: "flash",
          }}
          output="Found 5 files."
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="LoadSkill"
          input={{ name: "test-skill" }}
          output="Loaded"
        />
      </Box>
      <Box marginBottom={1}>
        <ToolDisplay
          name="AskUser"
          input={{
            question: "Which database should we use?",
            multiSelect: true,
          }}
        />
      </Box>
    </Box>
  );
}

render(<Demo />);
