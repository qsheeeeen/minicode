import fs from "fs";
import { runAgent, isAbortError, type AgentDeps } from "../agent.js";
import type { UserPrompter, Prompt } from "../tools/registry.js";
import type { CommandContext } from "./commands/index.js";
import { routeInput } from "./routing.js";
import { processRoute } from "./route-handler.js";
import { SessionPersistence } from "../services/session-persistence.js";
import type { ShellService } from "../services/shell-service.js";
import type { RuntimeEvents } from "../services/runtime-events.js";
import { HeadlessRenderer } from "./headless-renderer.js";

export async function runHeadless(
  deps: AgentDeps,
  initialPrompt: string | undefined,
  runtimeEvents: RuntimeEvents,
  shellService: ShellService,
  sessionName?: string,
  resumeRecent?: boolean,
  cmdContext?: CommandContext,
): Promise<void> {
  const { sessionManager, contextManager } = deps;

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

  // Set up renderer with status forwarding
  const renderer = new HeadlessRenderer(context);
  const unsubscribeRuntimeEvents = runtimeEvents.subscribe((event) => {
    if (event.type === "status.added") {
      renderer.addStatus(event.status);
    }
  });

  // Load session if requested
  if (sessionName || resumeRecent) {
    const name =
      sessionName ??
      (await SessionPersistence.getMostRecent()) ??
      `session-${Date.now()}`;
    const data = await SessionPersistence.load(name);
    if (data) {
      context.replaceBlocks(data.blocks);
      const totalTokens = data.totalTokens || 0;
      if (totalTokens > 0) {
        contextManager.setTokenCount(totalTokens);
      }
      const { createLogger } = await import("../utils/logger.js");
      const newLogger = await createLogger(
        SessionPersistence.getProjectHash(),
        name,
      );
      sessionManager.setSession(name);
      deps.logger = newLogger;
    }
  }

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
    // Route input: without cmdContext, run agent directly
    if (!cmdContext) {
      await runAgent(deps, initialPrompt, ctrl.signal, {
        prompter: headlessPrompter,
      });
      renderer.renderFinal();
      return;
    }

    const route = await routeInput(initialPrompt, cmdContext);
    const processed = processRoute(
      route,
      context,
      shellService,
      sessionManager.reportStatus.bind(sessionManager),
    );

    if (processed.type === "done") {
      if (processed.shellOutput) {
        console.log(
          `$ ${processed.shellOutput.command}\n${processed.shellOutput.output}`,
        );
      }
      renderer.renderFinal();
      return;
    }

    await runAgent(deps, processed.promptText, ctrl.signal, {
      prompter: headlessPrompter,
    });
    renderer.renderFinal();
  } catch (e) {
    if (isAbortError(e)) {
      console.log("(Aborted)");
    } else if (e instanceof Error) {
      console.error(`(Error: ${e.message})`);
    } else {
      throw e;
    }
  } finally {
    unsubscribeRuntimeEvents();
    renderer.stop();
  }
}
