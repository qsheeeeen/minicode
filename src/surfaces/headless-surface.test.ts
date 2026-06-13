import { describe, it, expect, vi } from "vitest";
import { HeadlessSurface } from "./headless-surface.js";
import { runHeadless } from "../ui/headless.js";

vi.mock("../ui/headless.js", () => ({
  runHeadless: vi.fn().mockResolvedValue(undefined),
}));

function makeRuntime() {
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

describe("HeadlessSurface", () => {
  it("runs the headless adapter with runtime dependencies", async () => {
    const runtime = makeRuntime();

    await new HeadlessSurface().run(runtime);

    expect(runHeadless).toHaveBeenCalledWith(
      runtime.agent,
      runtime.initialPrompt,
      runtime.sessionManager,
      runtime.tokenCount$,
      runtime.sessionName,
      runtime.resumeRecent,
      runtime.commandContext,
    );
  });
});
