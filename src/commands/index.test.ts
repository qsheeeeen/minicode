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
  parseAndExecute,
  getCommandNames,
  getCommandList,
  getHelp,
  type CommandContext,
} from "./index.js";

const { messageStoreMock, configMock, skillsMock } = vi.hoisted(() => ({
  messageStoreMock: {
    getProjectHash: vi.fn().mockReturnValue("testhash"),
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue(undefined),
  },
  configMock: {
    setEffort: vi.fn().mockResolvedValue(undefined),
    loadConfig: vi.fn().mockResolvedValue({ providers: {} }),
  },
  skillsMock: {
    getAvailableSkills: vi.fn().mockReturnValue([]),
    getSkillBody: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("../messages.js", () => ({
  MessageStore: messageStoreMock,
}));

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../skills/index.js", () => skillsMock);

vi.mock("../config.js", () => ({
  setEffort: configMock.setEffort,
  loadConfig: configMock.loadConfig,
}));

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

  function makeStoreMock() {
    return { addStatus: vi.fn() };
  }

  function makeAgentMock(overrides: Record<string, any> = {}) {
    const store = makeStoreMock();
    return {
      getStore: vi.fn().mockReturnValue(store),
      ...overrides,
      __store: store,
    };
  }

  describe("handlers", () => {
    it("/exit calls ctx.exit()", async () => {
      const ctx: Partial<CommandContext> = { exit: vi.fn() };
      const result = await parseAndExecute(
        "/exit",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.exit).toHaveBeenCalled();
    });

    it("/compress calls ctx.agent.compress() and adds status via store", async () => {
      const agentMock = makeAgentMock({
        compress: vi.fn().mockResolvedValue(undefined),
      });
      const ctx: Partial<CommandContext> = { agent: agentMock as any };

      const result = await parseAndExecute(
        "/compress",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(agentMock.compress).toHaveBeenCalled();
      expect(agentMock.__store.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/clear clears session and adds status via store", async () => {
      const agentMock = makeAgentMock({
        clearSession: vi.fn(),
        setTokenCount: vi.fn(),
        setSession: vi.fn(),
        setLogger: vi.fn(),
      });
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        setCurrentSession: vi.fn(),
        setMessages: vi.fn(),
      };

      const result = await parseAndExecute(
        "/clear",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(agentMock.clearSession).toHaveBeenCalled();
      expect(agentMock.setTokenCount).toHaveBeenCalledWith(0);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith(
        expect.stringMatching(/^session-/),
      );
      expect(agentMock.__store.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/new creates new session and adds status via store", async () => {
      const agentMock = makeAgentMock({
        clearSession: vi.fn(),
        setSession: vi.fn(),
        setLogger: vi.fn(),
      });
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        setCurrentSession: vi.fn(),
      };

      const result = await parseAndExecute(
        "/new my new session",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(agentMock.clearSession).toHaveBeenCalled();
      expect(agentMock.setSession).toHaveBeenCalledWith("my new session");
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("my new session");
      expect(agentMock.__store.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/rename renames session and adds status via store", async () => {
      const storeMock = makeStoreMock();
      const agentMock = {
        currentSession: "old-session",
        setSession: vi.fn(),
        setLogger: vi.fn(),
        getStore: vi.fn().mockReturnValue(storeMock),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        setCurrentSession: vi.fn(),
      };

      const result = await parseAndExecute(
        "/rename new-session",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(messageStoreMock.rename).toHaveBeenCalledWith(
        "old-session",
        "new-session",
      );
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("new-session");
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with no args lists sessions", async () => {
      messageStoreMock.list.mockResolvedValue([
        { name: "session-1" },
        { name: "session-2" },
      ]);
      const ctx: Partial<CommandContext> = {
        setInputMode: vi.fn(),
      };

      const result = await parseAndExecute(
        "/resume",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(messageStoreMock.list).toHaveBeenCalled();
      expect(ctx.setInputMode).toHaveBeenCalledWith("session-list", {
        sessions: [{ name: "session-1" }, { name: "session-2" }],
      });
    });

    it("/resume with args loads session", async () => {
      messageStoreMock.load.mockResolvedValue({
        messages: [],
        totalTokens: 100,
      });
      const storeMock = { addStatus: vi.fn() };
      const agentMock = {
        setMessages: vi.fn(),
        setTokenCount: vi.fn(),
        setSession: vi.fn(),
        setLogger: vi.fn(),
        getTools: vi.fn(),
        getStore: vi.fn().mockReturnValue(storeMock),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        setCurrentSession: vi.fn(),
        setMessages: vi.fn(),
      };

      const result = await parseAndExecute(
        "/resume session-1",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(messageStoreMock.load).toHaveBeenCalledWith("session-1");
      expect(agentMock.setMessages).toHaveBeenCalled();
      expect(agentMock.setTokenCount).toHaveBeenCalledWith(100);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("session-1");
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with unknown session shows error", async () => {
      messageStoreMock.load.mockResolvedValue(null);
      const storeMock = { addStatus: vi.fn() };
      const ctx: Partial<CommandContext> = {
        agent: { getStore: vi.fn().mockReturnValue(storeMock) } as any,
        setMessages: vi.fn(),
      };

      const result = await parseAndExecute(
        "/resume unknown",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "error" }),
      );
    });

    it("/plan returns prompt text", async () => {
      const result = await parseAndExecute(
        "/plan",
        {} as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(result.promptText).toContain("executable plan");
    });

    it("/test returns prompt text", async () => {
      const result = await parseAndExecute(
        "/test",
        {} as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(result.promptText).toContain("smoke test of your available tools");
    });

    it("/effort with no args shows effort select UI", async () => {
      const ctx: Partial<CommandContext> = {
        setInputMode: vi.fn(),
      };
      const result = await parseAndExecute(
        "/effort",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("effort-select");
    });

    it("/effort with invalid value shows effort select UI", async () => {
      const ctx: Partial<CommandContext> = {
        setInputMode: vi.fn(),
      };
      const result = await parseAndExecute(
        "/effort invalid",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("effort-select");
    });

    it("/effort with valid value sets effort and adds status", async () => {
      const storeMock = { addStatus: vi.fn() };
      const agentMock = {
        setEffort: vi.fn(),
        getStore: vi.fn().mockReturnValue(storeMock),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
      };
      const result = await parseAndExecute(
        "/effort high",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(agentMock.setEffort).toHaveBeenCalledWith("high");
      expect(configMock.setEffort).toHaveBeenCalledWith("high");
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content: "(Effort set to: high)",
        }),
      );
    });

    it("/skills with no skills shows no-skills status", async () => {
      skillsMock.getAvailableSkills.mockReturnValue([]);
      const storeMock = { addStatus: vi.fn() };
      const agentMock = { getStore: vi.fn().mockReturnValue(storeMock) };
      const ctx: Partial<CommandContext> = { agent: agentMock as any };

      const result = await parseAndExecute(
        "/skills",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(storeMock.addStatus).toHaveBeenCalledWith(
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
      const storeMock = { addStatus: vi.fn() };
      const agentMock = { getStore: vi.fn().mockReturnValue(storeMock) };
      const ctx: Partial<CommandContext> = { agent: agentMock as any };

      const result = await parseAndExecute(
        "/skills",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content:
            "Available skills:\n  /my-skill - A custom skill\n  /other - Another one",
        }),
      );
    });

    it("/model shows model select UI", async () => {
      configMock.loadConfig.mockResolvedValue({
        providers: { anthropic: {}, zhipu: {} },
      });
      const ctx: Partial<CommandContext> = {
        setInputMode: vi.fn(),
      };
      const result = await parseAndExecute(
        "/model",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(ctx.setInputMode).toHaveBeenCalledWith("model-select", {
        providers: { anthropic: {}, zhipu: {} },
        tiers: {},
      });
    });
  });
});
