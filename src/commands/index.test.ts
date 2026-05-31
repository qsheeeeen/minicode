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
import { commandRegistry, type CommandContext } from "./index.js";

const { sessionManagerMock, configMock } = vi.hoisted(() => ({
  sessionManagerMock: {
    getProjectHash: vi.fn().mockReturnValue("testhash"),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue(undefined),
  },
  configMock: {
    setEffort: vi.fn().mockResolvedValue(undefined),
    loadConfig: vi.fn().mockResolvedValue({ providers: {} }),
  },
}));

vi.mock("../utils/session.js", () => ({
  sessionManager: sessionManagerMock,
}));

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../skills/index.js", () => ({
  skillRegistry: {
    getAvailableSkills: vi.fn().mockReturnValue([]),
    getSkillBody: vi.fn().mockReturnValue(undefined),
  },
}));

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
    // Commands are already registered on the real commandRegistry at import time
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers expected commands", () => {
    const names = commandRegistry.getCommandNames();

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
      const result = await commandRegistry.parseAndExecute(
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

      const result = await commandRegistry.parseAndExecute(
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

      const result = await commandRegistry.parseAndExecute(
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

      const result = await commandRegistry.parseAndExecute(
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

      const result = await commandRegistry.parseAndExecute(
        "/rename new-session",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionManagerMock.rename).toHaveBeenCalledWith(
        "old-session",
        "new-session",
      );
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("new-session");
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with no args lists sessions", async () => {
      sessionManagerMock.list.mockResolvedValue([
        { name: "session-1" },
        { name: "session-2" },
      ]);
      const ctx: Partial<CommandContext> = {
        setInputMode: vi.fn(),
      };

      const result = await commandRegistry.parseAndExecute(
        "/resume",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionManagerMock.list).toHaveBeenCalled();
      expect(ctx.setInputMode).toHaveBeenCalledWith("session-list", {
        sessions: [{ name: "session-1" }, { name: "session-2" }],
      });
    });

    it("/resume with args loads session", async () => {
      sessionManagerMock.get.mockResolvedValue({
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

      const result = await commandRegistry.parseAndExecute(
        "/resume session-1",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(sessionManagerMock.get).toHaveBeenCalledWith("session-1");
      expect(agentMock.setMessages).toHaveBeenCalled();
      expect(agentMock.setTokenCount).toHaveBeenCalledWith(100);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith("session-1");
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/resume with unknown session shows error", async () => {
      sessionManagerMock.get.mockResolvedValue(null);
      const storeMock = { addStatus: vi.fn() };
      const ctx: Partial<CommandContext> = {
        agent: { getStore: vi.fn().mockReturnValue(storeMock) } as any,
        setMessages: vi.fn(),
      };

      const result = await commandRegistry.parseAndExecute(
        "/resume unknown",
        ctx as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(storeMock.addStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "error" }),
      );
    });

    it("/plan returns prompt text", async () => {
      const result = await commandRegistry.parseAndExecute(
        "/plan",
        {} as CommandContext,
      );
      expect(result.handled).toBe(true);
      expect(result.promptText).toContain("executable plan");
    });

    it("/test returns prompt text", async () => {
      const result = await commandRegistry.parseAndExecute(
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
      const result = await commandRegistry.parseAndExecute(
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
      const result = await commandRegistry.parseAndExecute(
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
      const result = await commandRegistry.parseAndExecute(
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
      const skillRegistry = await import("../skills/index.js");
      (skillRegistry.skillRegistry.getAvailableSkills as any).mockReturnValue(
        [],
      );
      const storeMock = { addStatus: vi.fn() };
      const agentMock = { getStore: vi.fn().mockReturnValue(storeMock) };
      const ctx: Partial<CommandContext> = { agent: agentMock as any };

      const result = await commandRegistry.parseAndExecute(
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
      const skillRegistry = await import("../skills/index.js");
      (skillRegistry.skillRegistry.getAvailableSkills as any).mockReturnValue([
        { name: "my-skill", description: "A custom skill" },
        { name: "other", description: "Another one" },
      ]);
      const storeMock = { addStatus: vi.fn() };
      const agentMock = { getStore: vi.fn().mockReturnValue(storeMock) };
      const ctx: Partial<CommandContext> = { agent: agentMock as any };

      const result = await commandRegistry.parseAndExecute(
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
      const result = await commandRegistry.parseAndExecute(
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

describe("CommandRegistry", () => {
  let savedCommands: Map<string, any>;

  beforeEach(() => {
    savedCommands = new Map((commandRegistry as any).commands);
    (commandRegistry as any).commands = new Map();
  });

  afterEach(() => {
    (commandRegistry as any).commands = savedCommands;
  });

  function createMockContext(): CommandContext {
    return {
      agent: {} as any,
      setMessages: vi.fn(),
      setCurrentSession: vi.fn(),
      setMode: vi.fn(),
      setInputMode: vi.fn(),
      setSessionList: vi.fn(),
      setSelectedIndex: vi.fn(),
      exit: vi.fn(),
    };
  }

  describe("register", () => {
    it("registers command with handler", async () => {
      const handler = vi.fn();
      commandRegistry.register({
        name: "test",
        description: "Test command",
        handler,
      });
      const result = await commandRegistry.parseAndExecute(
        "/test",
        createMockContext(),
      );
      expect(result.handled).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it("registers command with prompt", async () => {
      commandRegistry.register({
        name: "idea",
        description: "Share ideas",
        prompt: () => "Here is my idea",
      });
      const result = await commandRegistry.parseAndExecute(
        "/idea",
        createMockContext(),
      );
      expect(result.handled).toBe(true);
      expect(result.promptText).toBe("Here is my idea");
    });

    it("throws when neither handler nor prompt provided", () => {
      expect(() =>
        commandRegistry.register({
          name: "bad",
          description: "Invalid",
        } as any),
      ).toThrow("must have either handler or prompt");
    });

    it("throws when both handler and prompt provided", () => {
      expect(() =>
        commandRegistry.register({
          name: "bad",
          description: "Invalid",
          handler: vi.fn(),
          prompt: () => "text",
        } as any),
      ).toThrow("cannot have both handler and prompt");
    });
  });

  describe("parseAndExecute", () => {
    it("returns handled=false for non-command input", async () => {
      const result = await commandRegistry.parseAndExecute(
        "hello",
        createMockContext(),
      );
      expect(result.handled).toBe(false);
    });

    it("strips leading slash and parses args", async () => {
      const handler = vi.fn();
      commandRegistry.register({ name: "cmd", description: "Test", handler });
      await commandRegistry.parseAndExecute(
        "/cmd arg1 arg2",
        createMockContext(),
      );
      expect(handler).toHaveBeenCalledWith(["arg1", "arg2"], expect.anything());
    });

    it("trims whitespace", async () => {
      const handler = vi.fn();
      commandRegistry.register({ name: "cmd", description: "Test", handler });
      await commandRegistry.parseAndExecute(
        "/cmd  arg1  ",
        createMockContext(),
      );
      expect(handler).toHaveBeenCalledWith(["arg1"], expect.anything());
    });

    it("returns handled=false for unknown command", async () => {
      const result = await commandRegistry.parseAndExecute(
        "/unknown",
        createMockContext(),
      );
      expect(result.handled).toBe(false);
    });
  });

  describe("getCommandNames", () => {
    it("returns all registered command names", () => {
      commandRegistry.register({
        name: "cmd1",
        description: "One",
        handler: vi.fn(),
      });
      commandRegistry.register({
        name: "cmd2",
        description: "Two",
        handler: vi.fn(),
      });
      expect(commandRegistry.getCommandNames()).toContain("cmd1");
      expect(commandRegistry.getCommandNames()).toContain("cmd2");
    });
  });

  describe("getCommandList", () => {
    it("returns command names and descriptions", () => {
      commandRegistry.register({
        name: "test",
        description: "A test command",
        handler: vi.fn(),
      });
      const list = commandRegistry.getCommandList();
      expect(list).toContainEqual({
        name: "test",
        description: "A test command",
      });
    });
  });

  describe("getHelp", () => {
    it("formats help text", () => {
      commandRegistry.register({
        name: "exit",
        description: "Exit the app",
        handler: vi.fn(),
      });
      const help = commandRegistry.getHelp();
      expect(help).toContain("/exit - Exit the app");
    });
  });
});
