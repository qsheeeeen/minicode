import type { RouteResult } from "./routing.js";
import type { LLMContext } from "../core/context.js";
import type { StatusReporter } from "../services/session-manager.js";
import type { ShellService } from "../services/shell-service.js";

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
export async function processRoute(
  route: RouteResult,
  context: LLMContext,
  shellService: ShellService,
  reportStatus?: StatusReporter,
): Promise<ProcessedRoute> {
  if (route.action === "none") {
    return { type: "done" };
  }

  if (route.action === "shell") {
    const command = route.promptText!;
    // Async spawn — a long `!command` must not freeze the TUI's event loop.
    const output = shellService.formatResult(await shellService.run(command));

    // Inject into LLM context so the agent sees the command + result
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

  if (route.action === "unknown-command") {
    // A slash command that resolved to nothing — say so instead of
    // silently swallowing the input.
    reportStatus?.({
      role: "error",
      content: `Unknown command: /${route.command ?? ""}`,
      timestamp: new Date(),
    });
    return { type: "done" };
  }

  return {
    type: "run",
    promptText: route.promptText!,
    displayContent: route.displayContent,
  };
}
