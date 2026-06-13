import { render } from "ink";
import type { AppRuntime } from "../app/types.js";
import { App } from "../ui/tui.js";
import type { Surface } from "./types.js";

export class TuiSurface implements Surface {
  async run(runtime: AppRuntime): Promise<void> {
    render(
      <App
        agent={runtime.agent}
        config={runtime.config}
        version={runtime.version}
        promptFiles={runtime.promptFiles}
        initialSession={runtime.initialSession}
        initialPrompt={runtime.initialPrompt}
        sessionName={runtime.sessionName}
        resumeRecent={runtime.resumeRecent}
        agentRegistry={runtime.agentRegistry}
        programStartTime={runtime.programStartTime}
        sessionStats={runtime.sessionStats}
        modelSwitchService={runtime.modelSwitchService}
        sessionManager={runtime.sessionManager}
        context={runtime.sessionManager.getContext()}
        tokenCount$={runtime.tokenCount$}
        permissionService={runtime.permissionService}
      />,
      { exitOnCtrlC: false },
    );
  }
}
