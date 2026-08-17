import type { RouteResult } from "./routing.js";
import type { LLMContext } from "../core/context.js";
import type { StatusReporter } from "../services/session-manager.js";
import type { ShellService } from "../services/shell-service.js";

export type ProcessedRoute =
  | { type: "done"; shellOutput?: { command: string; output: string } }
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
  reportStatus: StatusReporter,
): Promise<ProcessedRoute> {
  switch (route.action) {
    case "none":
      return { type: "done" };

    case "shell": {
      // Async spawn — a long `!command` must not freeze the TUI's event loop.
      const output = shellService.formatResult(
        await shellService.run(route.command),
      );

      // Inject into LLM context so the agent sees the command + result
      context.startUserMessage(
        `Ran: ${route.command}\n\n\`\`\`\n${output}\n\`\`\``,
      );
      reportStatus({
        role: "status",
        content: `$ ${route.command}\n${output}`,
        toolDisplay: {
          name: "Shell",
          input: { command: route.command },
          output,
        },
      });
      return { type: "done", shellOutput: { command: route.command, output } };
    }

    case "unknown-command":
      // A slash command that resolved to nothing — say so instead of
      // silently swallowing the input.
      reportStatus({
        role: "error",
        content: `Unknown command: /${route.command}`,
      });
      return { type: "done" };

    case "command":
      return {
        type: "run",
        promptText: route.promptText,
        displayContent: route.displayContent,
      };

    case "llm":
      return { type: "run", promptText: route.promptText };
  }
}
