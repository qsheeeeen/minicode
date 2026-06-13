import { describe, it, expect, vi } from "vitest";
import { runHeadlessApp } from "./run-headless.js";
import { runHeadless } from "../ui/headless.js";

vi.mock("../ui/headless.js", () => ({
  runHeadless: vi.fn().mockResolvedValue(undefined),
}));

function makeApp() {
  return {
    agent: { id: "agent" },
    initialPrompt: "hello",
    sessionManager: { id: "session" },
    tokenCount$: { id: "tokens" },
    sessionName: "session-name",
    resumeRecent: false,
    commandContext: { id: "command-context" },
  } as any;
}

describe("runHeadlessApp", () => {
  it("runs the headless adapter with app dependencies", async () => {
    const app = makeApp();

    await runHeadlessApp(app);

    expect(runHeadless).toHaveBeenCalledWith(
      app.agent,
      app.initialPrompt,
      app.sessionManager,
      app.tokenCount$,
      app.sessionName,
      app.resumeRecent,
      app.commandContext,
    );
  });
});
