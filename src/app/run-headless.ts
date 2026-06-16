import type { AppRuntime } from "./types.js";
import { runHeadless } from "../ui/headless.js";

export async function runHeadlessApp(app: AppRuntime): Promise<void> {
  await runHeadless(
    app.deps,
    app.initialPrompt,
    app.runtimeEvents,
    app.sessionName,
    app.resumeRecent,
    app.commandContext,
  );
}
