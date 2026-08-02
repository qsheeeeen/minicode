import type { CommandHandler } from "../registry.js";

export const testCommand: CommandHandler = {
  name: "test",
  description: "Run a simple test across all available tools",
  prompt: () => {
    return "Ignore the project context. Run a simple smoke test of your available tools, use each tool once with minimal inputs, and report pass/fail for each.";
  },
};
