import fs from "fs";
import type { Agent } from "../agent.js";
import type { UserPrompter, Prompt } from "../tools/registry.js";
import type { CommandContext } from "./commands/index.js";
import { routeInput } from "./routing.js";
import { processRoute } from "./route-handler.js";
import { SessionPersistence } from "../services/session-persistence.js";
import type { SessionManager } from "../services/session-manager.js";
import type { Signal } from "../utils/signal.js";
import { HeadlessRenderer } from "./headless-renderer.js";

export async function runHeadless(
  agent: Agent,
  initialPrompt: string | undefined,
  sessionManager: SessionManager,
  tokenCount$: Signal<number>,
  sessionName?: string,
  resumeRecent?: boolean,
  cmdContext?: CommandContext,
): Promise<void> {
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
  sessionManager.setStatusReporter((msg) => {
    const turnIndex = context.getTurnCount();
    renderer.addStatus({ ...msg, turnIndex });
  });

  // Load session if requested
  if (sessionName || resumeRecent) {
    const name =
      sessionName ??
      (await SessionPersistence.getMostRecent()) ??
      `session-${Date.now()}`;
    const data = await SessionPersistence.load(name);
    if (data) {
      context.replaceTurns(data.turns);
      const totalTokens = data.totalTokens || 0;
      if (totalTokens > 0) {
        tokenCount$.set(totalTokens);
      }
      const { createLogger } = await import("../utils/logger.js");
      const newLogger = await createLogger(
        SessionPersistence.getProjectHash(),
        name,
      );
      sessionManager.setSession(name);
      agent.logger = newLogger;
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
    // Route input: without cmdContext, run agent directly
    if (!cmdContext) {
      await agent.run(initialPrompt, { prompter: headlessPrompter });
      renderer.renderFinal();
      return;
    }

    const route = await routeInput(initialPrompt, cmdContext);
    const processed = processRoute(
      route,
      initialPrompt,
      context,
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

    await agent.run(processed.promptText, { prompter: headlessPrompter });
    renderer.renderFinal();
  } catch (e) {
    if (e instanceof Error && e.message === "Aborted") {
      console.log("(Aborted)");
    } else if (e instanceof Error) {
      console.error(`(Error: ${e.message})`);
    } else {
      throw e;
    }
  } finally {
    renderer.stop();
  }
}
