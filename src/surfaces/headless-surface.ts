import type { AppRuntime } from "../app/types.js";
import { runHeadless } from "../ui/headless.js";
import type { Surface } from "./types.js";

export class HeadlessSurface implements Surface {
  async run(runtime: AppRuntime): Promise<void> {
    await runHeadless(
      runtime.agent,
      runtime.initialPrompt,
      runtime.sessionManager,
      runtime.tokenCount$,
      runtime.sessionName,
      runtime.resumeRecent,
      runtime.commandContext,
    );
  }
}
