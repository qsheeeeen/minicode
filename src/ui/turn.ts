import type { LLMContext } from "../llm/context.js";
import type { ShellService } from "../services/shell-service.js";
import type { StatusReporter } from "../services/session-manager.js";
import type { CommandContext } from "./commands/index.js";
import { processRoute, type ProcessedRoute } from "./route-handler.js";
import type { SessionTimeline } from "./timeline.js";

export interface ProcessRoutedInputOptions {
  input: string;
  /** Present in the full app; when absent input goes straight to the LLM. */
  cmdContext?: CommandContext;
  context: LLMContext;
  shellService: ShellService;
  reportStatus: StatusReporter;
  timeline: SessionTimeline;
}

/**
 * Route a single user input (shell / command / LLM), execute side effects for
 * non-LLM actions, and record display overrides on the shared timeline.
 * Shared by the headless runner and the TUI so both entry points behave
 * identically.
 */
export async function processRoutedInput(
  opts: ProcessRoutedInputOptions,
): Promise<ProcessedRoute> {
  const { input, cmdContext, context, shellService, reportStatus, timeline } =
    opts;
  const route = cmdContext
    ? await cmdContext.router.route(input, cmdContext)
    : { action: "llm" as const, promptText: input };
  const processed = processRoute(route, context, shellService, reportStatus);
  if (processed.type === "run" && processed.displayContent) {
    timeline.setDisplay(
      context.getUserMessageCount(),
      processed.displayContent,
    );
  }
  return processed;
}
