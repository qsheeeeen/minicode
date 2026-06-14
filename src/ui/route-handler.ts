import type { RouteResult } from "./routing.js";
import type { LLMHistory } from "../llm/history.js";
import type { StatusReporter } from "../services/session-manager.js";
import { runShell } from "../services/index.js";

export interface ShellOutput {
  command: string;
  output: string;
}

export type ProcessedRoute =
  | { type: "done"; shellOutput?: ShellOutput }
  | { type: "run"; promptText: string; displayContent?: string };

/**
 * Process a routed input: execute shell commands, handle system commands,
 * or pass through to the LLM. Returns what the caller should do next.
 *
 * Shell results are always injected into the agent's context so
 * the LLM can see them in future user messages, regardless of display mode.
 */
export function processRoute(
  route: RouteResult,
  rawInput: string,
  context: LLMHistory,
  reportStatus?: StatusReporter,
): ProcessedRoute {
  if (route.action === "none") {
    return { type: "done" };
  }

  if (route.action === "shell") {
    const command = route.promptText!;
    const output = runShell(command);

    // Inject into LLM history so the agent sees the command + result
    context.startUserMessage(`Ran: ${command}\n\n\`\`\`\n${output}\n\`\`\``);
    reportStatus?.({
      role: "status",
      content: `$ ${command}\n${output}`,
      toolDisplay: {
        name: "Shell",
        input: { command },
        output,
      },
      timestamp: new Date(),
    });
    return { type: "done", shellOutput: { command, output } };
  }

  if (route.action === "command" && !route.promptText) {
    return { type: "done" };
  }

  return {
    type: "run",
    promptText: route.promptText!,
    displayContent: route.displayContent,
  };
}
