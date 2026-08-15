import { describe, it, expect, vi } from "vitest";
import { Model } from "../../llm/model.js";
import type { AgentDeps } from "../../agent.js";
import { createCommandContext } from "./create-context.js";
import { CommandRegistry } from "./registry.js";
import type { InputRequest } from "./index.js";
import { createDefaultSkillRegistry } from "../../skills/index.js";
import { createDefaultRouter } from "../routing.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../services/session-persistence.js", () => ({
  SessionPersistence: {
    getProjectHash: vi.fn().mockReturnValue("testhash"),
    rename: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
  },
}));

function makeOpts(overrides: Record<string, any> = {}) {
  const context = { replaceBlocks: vi.fn(), getBlocks: () => [] };
  const journal = { id: "journal" };
  const sessionManager = {
    getContext: () => context,
    getChangeJournal: () => journal,
    getSessionName: vi.fn().mockReturnValue("old-session"),
    setSession: vi.fn(),
    reportStatus: vi.fn(),
  };
  const model = new Model("m", "p", 200000);
  const deps = {
    client: {} as any,
    model,
    sessionManager,
    contextManager: {},
    toolExecutor: {},
    promptManager: {},
  } as unknown as AgentDeps;
  const runtimeState = { setLogger: vi.fn() };
  const sessionStats = { incrementSessionCount: vi.fn() };
  const bridges = {
    isAgentRunning: vi.fn().mockReturnValue(true),
    presentInput: vi.fn(),
    exit: vi.fn(),
  };
  const opts = {
    deps,
    config: {} as any,
    commands: new CommandRegistry(),
    skills: createDefaultSkillRegistry(),
    router: createDefaultRouter(),
    sessionStats,
    modelSwitchService: {} as any,
    contextManager: { setTokenCount: vi.fn() },
    runtimeState,
    bridges,
    ...overrides,
  };
  return {
    opts,
    context,
    journal,
    sessionManager,
    runtimeState,
    sessionStats,
    bridges,
  };
}

describe("createCommandContext", () => {
  it("exposes model, context, and changeJournal from deps", () => {
    const { opts, context, journal } = makeOpts();
    const ctx = createCommandContext(opts);
    expect(ctx.model).toBe(opts.deps.model);
    expect(ctx.context).toBe(context);
    expect(ctx.changeJournal).toBe(journal);
    expect(ctx.sessionManager).toBe(opts.deps.sessionManager);
  });

  it("resumeSession restores blocks, tokens, and activates the session", async () => {
    const { SessionPersistence } =
      await import("../../services/session-persistence.js");
    (SessionPersistence.load as ReturnType<typeof vi.fn>).mockResolvedValue({
      blocks: [{ type: "user", text: "x" }],
      totalTokens: 42,
    });
    const { opts, context, sessionManager } = makeOpts();
    const ctx = createCommandContext(opts);

    const result = await ctx.resumeSession("s-1");

    expect(result).toEqual({ loaded: true });
    expect(context.replaceBlocks).toHaveBeenCalledWith([
      { type: "user", text: "x" },
    ]);
    expect(opts.contextManager.setTokenCount).toHaveBeenCalledWith(42);
    expect(sessionManager.setSession).toHaveBeenCalledWith("s-1");
  });

  it("resumeSession surfaces a missing session as {loaded:false}", async () => {
    const { SessionPersistence } =
      await import("../../services/session-persistence.js");
    (SessionPersistence.load as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    const { opts, context } = makeOpts();
    const ctx = createCommandContext(opts);

    const result = await ctx.resumeSession("missing");

    expect(result).toEqual({ loaded: false });
    expect(context.replaceBlocks).not.toHaveBeenCalled();
  });

  it("switchSession wires session, logger, stats, and status", async () => {
    const { opts, sessionManager, runtimeState, sessionStats } = makeOpts();
    const ctx = createCommandContext(opts);
    await ctx.switchSession("new-session", { statusMessage: "Switched" });
    expect(sessionManager.setSession).toHaveBeenCalledWith("new-session");
    expect(runtimeState.setLogger).toHaveBeenCalled();
    expect(sessionStats.incrementSessionCount).toHaveBeenCalledWith(
      "new-session",
    );
    expect(sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "Switched" }),
    );
  });

  it("renameCurrentSession renames, switches session, and swaps logger", async () => {
    const { opts, sessionManager, runtimeState } = makeOpts();
    const ctx = createCommandContext(opts);
    await ctx.renameCurrentSession("new-session");
    const { SessionPersistence } =
      await import("../../services/session-persistence.js");
    expect(SessionPersistence.rename).toHaveBeenCalledWith(
      "old-session",
      "new-session",
    );
    expect(sessionManager.setSession).toHaveBeenCalledWith("new-session");
    expect(runtimeState.setLogger).toHaveBeenCalled();
    expect(sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "status",
        content: "Renamed: old-session -> new-session",
      }),
    );
  });

  it("forwards bridges to isAgentRunning/presentInput/exit", () => {
    const { opts, bridges } = makeOpts();
    const ctx = createCommandContext(opts);
    expect(ctx.isAgentRunning()).toBe(true);
    const request: InputRequest = { type: "effort-picker" };
    ctx.presentInput(request);
    expect(bridges.presentInput).toHaveBeenCalledWith(request);
    ctx.exit();
    expect(bridges.exit).toHaveBeenCalled();
  });
});
