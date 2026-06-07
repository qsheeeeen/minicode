import type { CommandContext } from "./commands/index.js";
import { executeCommand } from "./commands/index.js";

export interface RouteResult {
  action: "none" | "bash" | "command" | "llm";
  promptText?: string;
  displayContent?: string;
}

export async function routeInput(
  input: string,
  cmdContext: CommandContext,
): Promise<RouteResult> {
  const trimmed = input.trim();
  if (!trimmed) return { action: "none" };

  if (trimmed.startsWith("!")) {
    const cmd = trimmed.slice(1).trim();
    if (!cmd) return { action: "none" };
    return { action: "bash", promptText: cmd };
  }

  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const result = await executeCommand(parts[0], parts.slice(1), cmdContext);
    if (result.handled && result.promptText) {
      return {
        action: "command",
        promptText: result.promptText,
        displayContent: result.displayContent,
      };
    }
    return { action: "command" };
  }

  return { action: "llm", promptText: trimmed };
}
