import type { AppRuntime } from "./types.js";
import { runHeadless } from "../ui/headless.js";

export async function runHeadlessApp(app: AppRuntime): Promise<void> {
  await runHeadless(
    app.agent,
    app.initialPrompt,
    app.sessionManager,
    app.contextManager,
    app.sessionName,
    app.resumeRecent,
    app.commandContext,
  );
}
