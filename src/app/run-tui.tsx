import { render } from "ink";
import type { AppRuntime } from "./types.js";
import { App, type AppProps } from "../ui/tui.js";

export async function runTuiApp(app: AppRuntime): Promise<void> {
  const props: AppProps = {
    deps: app.deps,
    runtimeState: app.runtimeState,
    config: app.config,
    version: app.version,
    promptFiles: app.promptFiles,
    initialSession: app.initialSession,
    initialPrompt: app.initialPrompt,
    agentRegistry: app.agentRegistry,
    runtimeEvents: app.runtimeEvents,
    programStartTime: app.programStartTime,
    sessionStats: app.sessionStats,
    modelSwitchService: app.modelSwitchService,
    sessionManager: app.sessionManager,
    contextManager: app.contextManager,
    context: app.sessionManager.getContext(),
    permissionService: app.permissionService,
    shellService: app.shellService,
    commandRegistry: app.commandRegistry,
    skillRegistry: app.skillRegistry,
    router: app.router,
  };
  render(<App {...props} />, {
    exitOnCtrlC: false,
    // Line-level diffing: Ink only rewrites changed lines, so previously
    // printed content stays untouched (terminal selection keeps working
    // while thinking/text streams).
    incrementalRendering: true,
  });
}
