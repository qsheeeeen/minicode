import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  registerCommand,
  executeCommand,
  getCommandNames,
  getCommandList,
  getHelp,
  type CommandContext,
} from "./index.js";

const { sessionPersistenceMock, configMock, skillsMock } = vi.hoisted(() => ({
  sessionPersistenceMock: {
    getProjectHash: vi.fn().mockReturnValue("testhash"),
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue(undefined),
    getMostRecent: vi.fn().mockResolvedValue(null),
    getSessionDir: vi.fn().mockReturnValue("/tmp/.minicode/sessions/testhash"),
  },
  configMock: {
    setEffort: vi.fn().mockResolvedValue(undefined),
    providers: {} as Record<string, any>,
    tiers: {} as Record<string, string>,
  },
  skillsMock: {
    getAvailableSkills: vi.fn().mockReturnValue([]),
    getSkillBody: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("../../services/session-persistence.js", () => ({
  SessionPersistence: sessionPersistenceMock,
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../skills/index.js", () => skillsMock);

vi.mock("react", () => ({
  createElement: vi.fn((...args: any[]) => args),
}));

vi.mock("ink", () => ({
  Box: "Box",
  Text: "Text",
}));

describe("Builtin commands", () => {
  beforeAll(() => {
    // Commands are already registered at import time
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers expected commands", () => {
    const names = getCommandNames();

    expect(names).toContain("exit");
    expect(names).toContain("clear");
    expect(names).toContain("compress");
    expect(names).toContain("effort");
    expect(names).toContain("new");
    expect(names).toContain("rename");
    expect(names).toContain("resume");
    expect(names).toContain("plan");
    expect(names).toContain("test");
    expect(names).toContain("skills");
    expect(names).toContain("model");
  });

  /** Create a mock context (ctx.context) */
  function makeContextMock() {
    return {
      setTurns: vi.fn(),
      getTurns: vi.fn().mockReturnValue([]),
    };
  }

  /** Create a mock Model (ctx.model) */
  function makeModelMock() {
    return {
      setEffort: vi.fn(),
    };
  }

  /** Create a mock SessionManager (ctx.sessionManager) */
  function makeSessionManagerMock(contextMock: ReturnType<typeof makeContextMock>) {
    return {
      setSession: vi.fn(),
      getStore: vi.fn().mockReturnValue(contextMock),
      getChangeJournal: vi.fn(),
      reportStatus: vi.fn(),
    };
  }

  /** Create a mock ChangeJournal (ctx.changeJournal) */
  function makeChangeJournalMock() {
    return {
      getEntriesByTurn: vi.fn().mockResolvedValue(new Map()),
    };
  }

  /** Create a mock Signal<number> (ctx.tokenCount$) */
  function makeTokenCountMock() {
    return {
      get: vi.fn().mockReturnValue(0),
      set: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
  }

  /** Build a full mock CommandContext with sensible defaults */
  function makeCtx(overrides: Record<string, any> = {}) {
    const context = makeContextMock();
    const model = makeModelMock();
    const sessionManager = makeSessionManagerMock(context);
    const changeJournal = makeChangeJournalMock();
    const tokenCount$ = makeTokenCountMock();

    const agent = {
      clearSession: vi.fn(),
      compress: vi.fn().mockResolvedValue(undefined),
      setSession: vi.fn(),
      setLogger: vi.fn(),
      currentSession: "test-session",
      logger: { info: vi.fn(), error: vi.fn() },
      isRunning: false,
      ...overrides.agent,
    };

    const ctx: Partial<CommandContext> = {
      agent: agent as any,
      model: model as any,
      config: configMock as any,
      context: context as any,
      sessionManager: sessionManager as any,
      changeJournal: changeJournal as any,
      tokenCount$: tokenCount$ as any,
      sessionStats: {
        incrementSessionCount: vi.fn(),
      } as any,
      setCurrentSession: vi.fn(),
      setMessages: vi.fn(),
      setInputMode: vi.fn(),
      exit: vi.fn(),
      ...overrides,
    };

    return { ctx, context, model, sessionManager, changeJournal, tokenCount$, agent };
  }

  describe("handlers", () => {
    it("/exit calls ctx.exit()", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("exit", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(ctx.exit).toHaveBeenCalled();
    });

    it("/compress calls ctx.agent.compress() and reports status", async () => {
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand(
        "compress",
        [],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.agent.compress).toHaveBeenCalled();
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/clear clears session and reports status", async () => {
      const { ctx, sessionManager, tokenCount$ } = makeCtx();

      const result = await executeCommand("clear", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(ctx.agent.clearSession).toHaveBeenCalled();
      expect(tokenCount$.set).toHaveBeenCalledWith(0);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith(
        expect.stringMatching(/^session-/),
      );
      // switchSession calls sessionManager.reportStatus()
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/new creates new session and reports status", async () => {
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand(
        "new",
        ["my", "new", "session"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.agent.clearSession).toHaveBeenCalled();
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("my new session");
      // switchSession calls sessionManager.reportStatus()
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/rename renames session and reports status", async () => {
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand(
        "rename",
        ["new-session"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionPersistenceMock.rename).toHaveBeenCalledWith(
        "test-session",
        "new-session",
      );
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("new-session");
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with no args lists sessions", async () => {
      sessionPersistenceMock.list.mockResolvedValue([
        { name: "session-1" },
        { name: "session-2" },
      ]);
      const { ctx } = makeCtx();

      const result = await executeCommand("resume", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(sessionPersistenceMock.list).toHaveBeenCalled();
      expect(ctx.setInputMode).toHaveBeenCalledWith("session-list", {
        sessions: [{ name: "session-1" }, { name: "session-2" }],
      });
    });

    it("/resume with args loads session", async () => {
      sessionPersistenceMock.load.mockResolvedValue({
        messages: [],
        totalTokens: 100,
      });
      const { ctx, context, tokenCount$, sessionManager } = makeCtx();

      const result = await executeCommand(
        "resume",
        ["session-1"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionPersistenceMock.load).toHaveBeenCalledWith("session-1");
      expect(context.setTurns).toHaveBeenCalled();
      expect(tokenCount$.set).toHaveBeenCalledWith(100);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("session-1");
      // switchSession reports a status message
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with unknown session shows error", async () => {
      sessionPersistenceMock.load.mockResolvedValue(null);
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand(
        "resume",
        ["unknown"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "error" }),
      );
    });

    it("/plan returns prompt text", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("plan", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(result.promptText).toContain("executable plan");
    });

    it("/test returns prompt text", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("test", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(result.promptText).toContain("smoke test of your available tools");
    });

    it("/effort with no args shows effort select UI", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("effort", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("effort-select");
    });

    it("/effort with invalid value shows effort select UI", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand(
        "effort",
        ["invalid"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("effort-select");
    });

    it("/effort with valid value sets effort and reports status", async () => {
      const { ctx, sessionManager, model } = makeCtx();
      const result = await executeCommand(
        "effort",
        ["high"],
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(model.setEffort).toHaveBeenCalledWith("high");
      expect(configMock.setEffort).toHaveBeenCalledWith("high");
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content: "(Effort set to: high)",
        }),
      );
    });

    it("/skills with no skills shows no-skills status", async () => {
      skillsMock.getAvailableSkills.mockReturnValue([]);
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand("skills", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content: "(No skills available)",
        }),
      );
    });

    it("/skills with available skills renders skill list", async () => {
      skillsMock.getAvailableSkills.mockReturnValue([
        { name: "my-skill", description: "A custom skill" },
        { name: "other", description: "Another one" },
      ]);
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand("skills", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content:
            "Available skills:\n  /my-skill - A custom skill\n  /other - Another one",
        }),
      );
    });

    it("/model shows model select UI", async () => {
      configMock.providers = { anthropic: {}, openai: {} };
      configMock.tiers = {};
      const { ctx } = makeCtx();
      const result = await executeCommand("model", [], ctx as CommandContext);
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("model-select", {
        providers: { anthropic: {}, openai: {} },
        tiers: {},
      });
    });
  });
});
