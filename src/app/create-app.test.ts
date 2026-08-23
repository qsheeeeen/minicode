import { beforeEach, describe, it, expect, vi } from "vitest";
import { AppConfig } from "../config.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { createApp } from "./create-app.js";

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("../utils/prompts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/prompts.js")>()),
  loadGlobalPrompt: vi.fn().mockResolvedValue("global prompt"),
}));

vi.mock("../skills/skill-manager.js", () => ({
  SkillManager: vi.fn().mockImplementation(function () {
    return {
      addDirectory: vi.fn().mockReturnThis(),
      loadAll: vi.fn().mockResolvedValue(undefined),
      registerAsCommands: vi.fn(),
    };
  }),
}));

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      protocol: "anthropic",
      apiKey: "test-key",
      model: "test-model",
      provider: "test-provider",
      contextLength: 1000,
      displayName: "Test Model",
    },
    permissionMode: "yolo",
    compressionThreshold: 0.5,
    thinking: {},
    initialPrompt: "hello",
    sessionName: "test-session",
    resumeRecent: false,
    headless: true,
    ...overrides,
  } as any;
}

describe("createApp", () => {
  beforeEach(() => {
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-app-test",
    );
    vi.spyOn(SessionPersistence, "loadTree").mockResolvedValue(null);
  });

  it("creates the application app object graph", async () => {
    const config = new AppConfig({});

    const runtime = await createApp({
      args: makeArgs(),
      config,
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });

    expect(runtime.deps).toBeDefined();
    expect(runtime.config).toBe(config);
    expect(runtime.version).toBe("1.0.0");
    expect(runtime.headless).toBe(true);
    expect(runtime.initialSession).toBe("test-session");
    expect(runtime.promptFiles).toContain("~/.minicode/AGENTS.md");
    expect("agent" in runtime.commandContext).toBe(false);
    expect(runtime.commandContext.model.getName()).toBe("test-model");
  });

  it("excludes interactive tools in headless mode", async () => {
    const config = new AppConfig({});
    const runtime = await createApp({
      args: makeArgs({ headless: true }),
      config,
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });
    expect(runtime.deps.toolExecutor.getTools().has("AskUser")).toBe(false);
  });

  it("keeps interactive tools in TUI mode", async () => {
    const config = new AppConfig({});
    const runtime = await createApp({
      args: makeArgs({ headless: false }),
      config,
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: true,
    });
    expect(runtime.deps.toolExecutor.getTools().has("AskUser")).toBe(true);
  });

  it("emits runtime status events for token threshold messages", async () => {
    const runtime = await createApp({
      args: makeArgs(),
      config: new AppConfig({}),
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });
    const listener = vi.fn();
    runtime.runtimeEvents.subscribe(listener);

    await runtime.contextManager.processUsage({
      input: { total: 600, cache_hit: 0, cache_miss: 600 },
      output: 0,
    });

    expect(listener).toHaveBeenCalledWith({
      type: "status.added",
      status: expect.objectContaining({ role: "status" }),
    });
  });

  it("runtime deps follow model switches through RuntimeState", async () => {
    const config = new AppConfig(
      {
        providers: {
          test: {
            apiKey: "test-key",
            protocol: "anthropic",
            models: { "next-model": { contextLength: 1234 } },
          },
        },
        model: "test-model@test",
      },
      "/tmp/minicode-app-test/config.json", // remapTier persists; keep off the real home
    );

    const runtime = await createApp({
      args: makeArgs(),
      config,
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });

    expect(runtime.deps.model).toBe(runtime.runtimeState.model);

    await runtime.modelSwitchService.remapTier("pro", "next-model@test");

    expect(runtime.deps.model.getName()).toBe("next-model");
    expect(runtime.runtimeState.model.getName()).toBe("next-model");
  });

  it("throws a tiers-pointing error when no model is configured", async () => {
    await expect(
      createApp({
        args: makeArgs({ model: null }),
        config: new AppConfig({}),
        version: "1.0.0",
        cwd: "/tmp",
        programStartTime: 123,
        stdinIsTTY: false,
      }),
    ).rejects.toThrow(/tiers\.pro/);
  });

  it("surfaces the -m modelError verbatim", async () => {
    await expect(
      createApp({
        args: makeArgs({
          model: null,
          modelError: '-m flash: tier "flash" has no resolvable model.',
        }),
        config: new AppConfig({}),
        version: "1.0.0",
        cwd: "/tmp",
        programStartTime: 123,
        stdinIsTTY: false,
      }),
    ).rejects.toThrow('tier "flash" has no resolvable model');
  });

  it("restores the initial session at composition time", async () => {
    vi.spyOn(SessionPersistence, "loadTree").mockResolvedValue({
      turns: [
        {
          type: "turn",
          id: "old-1",
          parentId: null,
          ts: 1,
          blocks: [{ type: "user", text: "old", id: "old-1" }],
        },
      ],
      activeTurnId: "old-1",
      model: "m",
      totalTokens: 10,
    });

    const runtime = await createApp({
      args: makeArgs(),
      config: new AppConfig({}),
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });

    expect(SessionPersistence.loadTree).toHaveBeenCalledWith("test-session");
    expect(runtime.sessionManager.getContext().getBlocks()).toEqual([
      expect.objectContaining({ type: "user", text: "old" }),
    ]);
    expect(runtime.contextManager.getTokenCount()).toBe(10);
    expect(runtime.runtimeState.logger).toBeDefined();
  });

  it("exposes the latest change journal through command context", async () => {
    const runtime = await createApp({
      args: makeArgs(),
      config: new AppConfig({}),
      version: "1.0.0",
      cwd: "/tmp",
      programStartTime: 123,
      stdinIsTTY: false,
    });
    const original = runtime.commandContext.changeJournal;

    runtime.sessionManager.clearSession();

    expect(runtime.commandContext.changeJournal).toBe(
      runtime.sessionManager.getChangeJournal(),
    );
    expect(runtime.commandContext.changeJournal).not.toBe(original);
  });
});
