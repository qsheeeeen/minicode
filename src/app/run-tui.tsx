import { render } from "ink";
import type { AppRuntime } from "./types.js";
import { App } from "../ui/tui.js";

export async function runTuiApp(app: AppRuntime): Promise<void> {
  render(
    <App
      agent={app.agent}
      config={app.config}
      version={app.version}
      promptFiles={app.promptFiles}
      initialSession={app.initialSession}
      initialPrompt={app.initialPrompt}
      sessionName={app.sessionName}
      resumeRecent={app.resumeRecent}
      agentRegistry={app.agentRegistry}
      programStartTime={app.programStartTime}
      sessionStats={app.sessionStats}
      modelSwitchService={app.modelSwitchService}
      sessionManager={app.sessionManager}
      contextManager={app.contextManager}
      context={app.sessionManager.getContext()}
      permissionService={app.permissionService}
    />,
    { exitOnCtrlC: false },
  );
}
