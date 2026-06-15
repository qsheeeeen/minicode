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

    expect(runtime.agent).toBeDefined();
    expect(runtime.config).toBe(config);
    expect(runtime.version).toBe("1.0.0");
    expect(runtime.headless).toBe(true);
    expect(runtime.initialSession).toBe("test-session");
    expect(runtime.promptFiles).toContain("~/.minicode/AGENTS.md");
    expect("agent" in runtime.commandContext).toBe(false);
    expect(runtime.commandContext.model.getName()).toBe("test-model");
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
      message: expect.objectContaining({ role: "status" }),
    });
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
