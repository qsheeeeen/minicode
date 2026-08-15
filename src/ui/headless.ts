import fs from "fs";
import type { AgentDeps } from "../agent.js";
import type { UserPrompter, Prompt } from "../tools/registry.js";
import type { CommandContext } from "./commands/index.js";
import type { ShellService } from "../services/shell-service.js";
import type { RuntimeEvents } from "../services/runtime-events.js";
import { HeadlessRenderer } from "./headless-renderer.js";
import { SessionTimeline } from "./timeline.js";
import { processRoutedInput, runAgentTurn } from "./turn.js";

export async function runHeadless(
  deps: AgentDeps,
  initialPrompt: string | undefined,
  runtimeEvents: RuntimeEvents,
  shellService: ShellService,
  cmdContext?: CommandContext,
): Promise<void> {
  const { sessionManager } = deps;

  // Read piped stdin (non-TTY) and append to the prompt
  if (!process.stdin.isTTY) {
    try {
      const pipedInput = fs.readFileSync(0, "utf-8").trim();
      if (pipedInput) {
        initialPrompt = initialPrompt
          ? `${initialPrompt}\n\n${pipedInput}`
          : pipedInput;
      }
    } catch {
      // Ignore read errors from empty/closed pipes
    }
  }

  if (!initialPrompt) {
    console.error("Error: --headless requires a prompt argument");
    process.exit(1);
  }

  const context = sessionManager.getContext();

  // Set up the shared timeline + printer with status forwarding.
  const timeline = new SessionTimeline(context);
  const renderer = new HeadlessRenderer(timeline);
  const unsubscribeRuntimeEvents = runtimeEvents.subscribe((event) => {
    if (event.type === "status.added") {
      timeline.appendStatus(event.status);
    }
  });

  const headlessPrompter: UserPrompter = {
    prompt: async (req: Prompt) => {
      console.log(
        `[Denied: ${req.message}] -- use --permission yolo or auto in headless mode`,
      );
      return "";
    },
  };

  renderer.start();

  try {
    const ctrl = new AbortController();
    let promptText = initialPrompt;

    // Route input: without cmdContext, run agent directly
    if (cmdContext) {
      const processed = await processRoutedInput({
        input: initialPrompt,
        cmdContext,
        context,
        shellService,
        reportStatus: sessionManager.reportStatus.bind(sessionManager),
        timeline,
      });

      if (processed.type === "done") {
        if (processed.shellOutput) {
          console.log(
            `$ ${processed.shellOutput.command}\n${processed.shellOutput.output}`,
          );
        }
        return;
      }
      promptText = processed.promptText;
    }

    await runAgentTurn({
      deps,
      promptText,
      signal: ctrl.signal,
      prompter: headlessPrompter,
      reportStatus: sessionManager.reportStatus.bind(sessionManager),
    });
  } finally {
    renderer.renderFinal();
    unsubscribeRuntimeEvents();
    renderer.stop();
  }
}
