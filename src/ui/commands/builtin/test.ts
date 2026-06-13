import { registerCommand } from "../registry.js";

registerCommand({
  name: "test",
  description: "Run a simple test across all available tools",
  prompt: () => {
    return "Ignore the project context. Run a simple smoke test of your available tools, use each tool once with minimal inputs, and report pass/fail for each.";
  },
});
