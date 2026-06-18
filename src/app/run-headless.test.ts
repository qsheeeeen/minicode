import { describe, it, expect, vi } from "vitest";
import { runHeadlessApp } from "./run-headless.js";
import { runHeadless } from "../ui/headless.js";

vi.mock("../ui/headless.js", () => ({
  runHeadless: vi.fn().mockResolvedValue(undefined),
}));

function makeApp() {
  return {
    deps: { id: "deps" },
    initialPrompt: "hello",
    runtimeEvents: { id: "runtime-events" },
    sessionName: "session-name",
    resumeRecent: false,
    commandContext: { id: "command-context" },
    shellService: { id: "shell-service" },
  } as any;
}

describe("runHeadlessApp", () => {
  it("runs the headless adapter with app dependencies", async () => {
    const app = makeApp();

    await runHeadlessApp(app);

    expect(runHeadless).toHaveBeenCalledWith(
      app.deps,
      app.initialPrompt,
      app.runtimeEvents,
      app.shellService,
      app.sessionName,
      app.resumeRecent,
      app.commandContext,
    );
  });
});
