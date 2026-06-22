// Shared mock data for TUI demos — keeps sample messages/sessions in one
// place so individual demos don't each reinvent them.
import type { DisplayMessage } from "../../display.js";
import type { AgentSession } from "../../../services/agent-registry.js";

export const sampleMessages: DisplayMessage[] = [
  { role: "user", content: "Help me set up Express with TypeScript." },
  {
    role: "thinking",
    content:
      "The user wants Express scaffolding. I'll initialize the project, read the entry point, then adjust the port.",
  },
  {
    role: "tool",
    name: "Shell",
    input: { command: "npm init -y" },
    output: "Wrote to package.json",
    slotId: "s1",
  },
  {
    role: "tool",
    name: "Read",
    input: { path: "src/index.ts" },
    output: "10 lines, 256 chars",
    slotId: "s2",
  },
  {
    role: "text",
    content: "Reading the entry point and preparing edits...",
    isStreaming: true,
  },
  {
    role: "tool",
    name: "Edit",
    input: { path: "src/app.ts" },
    output:
      "--- src/app.ts\n+++ src/app.ts\n  3 - const port = 3000;\n  3 + const port = 8080;",
    slotId: "s3",
  },
  {
    role: "text",
    content:
      "Done! Project scaffolded. Markdown showcase:\n\n# Heading\n\n**bold**, *italic*, `code`\n\n- item 1\n- item 2\n",
  },
  { role: "status", content: "Project scaffolded", timestamp: new Date() },
  {
    role: "status",
    content: "",
    timestamp: new Date(),
    toolDisplay: {
      name: "Edit",
      input: { path: "src/app.ts" },
      output:
        "--- src/app.ts\n+++ src/app.ts\n  3 - const port = 3000;\n  3 + const port = 8080;",
    },
  },
  {
    role: "error",
    content: "npm ERR! peer dependency conflict",
    timestamp: new Date(),
  },
];

export const sampleSessions: AgentSession[] = [
  {
    id: "1",
    type: "main",
    context: {} as any,
    status: "running",
    tokenCount: 12000,
    toolCalls: 5,
  },
  {
    id: "2",
    type: "sub",
    context: {} as any,
    status: "completed",
    task: "Install dependencies",
    tokenCount: 3200,
    toolCalls: 2,
  },
  {
    id: "3",
    type: "sub",
    context: {} as any,
    status: "error",
    task: "Run the test suite and report failures",
    tokenCount: 1100,
    toolCalls: 2,
  },
  {
    id: "4",
    type: "sub",
    context: {} as any,
    status: "idle",
    task: "Refactor the database layer",
  },
];
