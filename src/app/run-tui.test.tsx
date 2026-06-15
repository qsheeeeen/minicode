import { describe, it, expect, vi } from "vitest";
import { render } from "ink";
import { runTuiApp } from "./run-tui.js";

vi.mock("ink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ink")>()),
  render: vi.fn(),
}));

vi.mock("../ui/tui.js", () => ({
  App: () => null,
}));

function makeApp() {
  const sessionManager = {
    getContext: vi.fn().mockReturnValue({ id: "context" }),
  };
  return {
    agent: { id: "agent" },
    config: { id: "config" },
    version: "1.0.0",
    promptFiles: [],
    initialSession: "session",
    initialPrompt: "hello",
    sessionName: "session",
    resumeRecent: false,
    agentRegistry: { id: "registry" },
    programStartTime: 123,
    sessionStats: { id: "stats" },
    contextManager: { id: "context-manager" },
    modelSwitchService: { id: "model-switcher" },
    sessionManager,
    permissionService: { id: "permission" },
  } as any;
}

describe("runTuiApp", () => {
  it("renders the TUI app", async () => {
    const app = makeApp();

    await runTuiApp(app);

    expect(render).toHaveBeenCalledWith(expect.anything(), {
      exitOnCtrlC: false,
    });
    expect(app.sessionManager.getContext).toHaveBeenCalled();
  });
});
