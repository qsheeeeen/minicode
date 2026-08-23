import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeCommand,
  getCommandList,
  registerBuiltinCommands,
  registerSkillCommands,
  CommandRegistry,
  type CommandContext,
} from "./index.js";
import {
  createDefaultSkillRegistry,
  SkillRegistry,
} from "../../skills/index.js";
import { createDefaultRouter } from "../routing.js";
import { SessionTree } from "../../services/session-tree.js";

const { sessionPersistenceMock, configMock } = vi.hoisted(() => ({
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
}));

vi.mock("../../services/session-persistence.js", () => ({
  SessionPersistence: sessionPersistenceMock,
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

describe("Builtin commands", () => {
  let commands: CommandRegistry;
  let skills: SkillRegistry;

  beforeEach(() => {
    commands = new CommandRegistry();
    skills = createDefaultSkillRegistry();
    registerBuiltinCommands(commands);
    registerSkillCommands(commands, skills);
    vi.clearAllMocks();
  });

  it("registers expected commands", () => {
    const names = commands.getNames();

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
      replaceBlocks: vi.fn(),
      getBlocks: vi.fn().mockReturnValue([]),
      getUserMessages: vi.fn().mockReturnValue([]),
      getUserMessageSummaries: vi.fn().mockReturnValue([]),
      truncateBeforeUserMessageId: vi.fn(),
    };
  }

  /** Create a mock Model (ctx.model) */
  function makeModelMock() {
    return {
      setEffort: vi.fn(),
    };
  }

  /** Create a mock SessionManager (ctx.sessionManager) */
  function makeSessionManagerMock(
    contextMock: ReturnType<typeof makeContextMock>,
    tree?: SessionTree,
  ) {
    return {
      setSession: vi.fn(),
      getSessionName: vi.fn().mockReturnValue("test-session"),
      clearSession: vi.fn(),
      getStore: vi.fn().mockReturnValue(contextMock),
      getChangeJournal: vi.fn(),
      reportStatus: vi.fn(),
      saveStore: vi.fn().mockResolvedValue(undefined),
      getTree: vi.fn().mockReturnValue(tree ?? SessionTree.empty()),
    };
  }

  /** Create a mock ChangeJournal (ctx.changeJournal) */
  function makeChangeJournalMock() {
    return {
      getEntriesByUserMessage: vi.fn().mockResolvedValue(new Map()),
    };
  }

  /** Build a full mock CommandContext with sensible defaults */
  function makeCtx(overrides: Record<string, any> = {}) {
    const context = makeContextMock();
    const model = makeModelMock();
    const sessionManager = makeSessionManagerMock(context);
    const changeJournal = makeChangeJournalMock();

    const contextManager = {
      compress: vi.fn().mockResolvedValue(false),
      reset: vi.fn(),
      ...overrides.contextManager,
    };

    const ctx: Partial<CommandContext> = {
      model: model as any,
      config: configMock as any,
      context: context as any,
      commands,
      skills,
      router: createDefaultRouter(),
      sessionManager: sessionManager as any,
      changeJournal: changeJournal as any,
      sessionStats: {
        incrementSessionCount: vi.fn(),
      } as any,
      contextManager: contextManager as any,
      isAgentRunning: vi.fn().mockReturnValue(false),
      resumeSession: vi.fn().mockResolvedValue({ loaded: true }),
      switchSession: vi.fn().mockResolvedValue(undefined),
      renameCurrentSession: vi.fn().mockResolvedValue(undefined),
      presentInput: vi.fn(),
      exit: vi.fn(),
      ...overrides,
    };

    return {
      ctx,
      context,
      model,
      sessionManager,
      changeJournal,
      contextManager,
    };
  }

  describe("handlers", () => {
    it("/exit calls ctx.exit()", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("exit", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(ctx.exit).toHaveBeenCalled();
    });

    it("/undo <n> rolls back the conversation without a picker", async () => {
      const context = {
        ...makeContextMock(),
        getUserMessages: vi.fn().mockReturnValue(["first", "second"]),
        getUserMessageSummaries: vi
          .fn()
          .mockReturnValue([
            { id: "u1", ordinal: 1, text: "first" },
            { id: "u2", ordinal: 2, text: "second" },
          ]),
      };
      const journal = {
        getEntriesByUserMessage: vi.fn().mockResolvedValue(new Map()),
        pruneByMessageIds: vi.fn().mockResolvedValue(undefined),
      };
      const { ctx, sessionManager } = makeCtx({
        context,
        changeJournal: journal,
      });

      const result = await executeCommand("undo", ["2"], ctx as CommandContext);

      expect(result.kind).not.toBe("unknown");
      expect(context.truncateBeforeUserMessageId).toHaveBeenCalledWith("u2");
      expect(journal.pruneByMessageIds).toHaveBeenCalledWith(
        new Set(["u2"]),
      );
      expect(ctx.presentInput).not.toHaveBeenCalled();
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content: "(Rollback: conversation rolled back)",
        }),
      );
    });

    it("bare /undo presents a display-only picker (no domain handles)", async () => {
      const context = {
        ...makeContextMock(),
        getUserMessages: vi.fn().mockReturnValue(["first"]),
        getUserMessageSummaries: vi
          .fn()
          .mockReturnValue([{ id: "u1", ordinal: 1, text: "first" }]),
      };
      const { ctx } = makeCtx({
        context,
        changeJournal: {
          getEntriesByUserMessage: vi.fn().mockResolvedValue(new Map()),
        },
      });

      await executeCommand("undo", [], ctx as CommandContext);

      expect(ctx.presentInput).toHaveBeenCalledTimes(1);
      const request = (ctx.presentInput as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(request.type).toBe("rollback-picker");
      expect(request.userMessages).toEqual(["first"]);
      expect(request.messageIds).toEqual(["u1"]);
      expect(request.changeJournal).toBeUndefined();
      expect(request.context).toBeUndefined();
      expect(request.reportStatus).toBeUndefined();
    });

    it("/undo with an out-of-range number reports an error", async () => {
      const context = {
        ...makeContextMock(),
        getUserMessages: vi.fn().mockReturnValue(["first"]),
      };
      const { ctx, sessionManager } = makeCtx({ context });

      await executeCommand("undo", ["9"], ctx as CommandContext);

      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "error",
          content: "(Invalid message number: 9)",
        }),
      );
    });

    describe("/fork", () => {
      function makeForkContext() {
        return {
          ...makeContextMock(),
          getUserMessages: vi.fn().mockReturnValue(["first", "second"]),
          getUserMessageSummaries: vi
            .fn()
            .mockReturnValue([
              { id: "u1", ordinal: 1, text: "first" },
              { id: "u2", ordinal: 2, text: "second" },
            ]),
        };
      }

      function makeForkTree() {
        const tree = SessionTree.empty();
        tree.appendTurn("u1", [{ type: "user", text: "first", id: "u1" }]);
        tree.appendTurn("u2", [{ type: "user", text: "second", id: "u2" }]);
        return tree;
      }

      it("registers fork and tree commands", () => {
        const names = commands.getNames();
        expect(names).toContain("fork");
        expect(names).toContain("tree");
      });

      it("/fork <n> moves the leaf to the parent and restores that path", async () => {
        const context = makeForkContext();
        const tree = makeForkTree();
        const sessionManager = makeSessionManagerMock(context, tree);
        const { ctx } = makeCtx({ context, sessionManager });

        await executeCommand("fork", ["2"], ctx as CommandContext);

        // Non-destructive: u2 stays in the tree, leaf points at u1.
        expect(tree.has("u2")).toBe(true);
        expect(tree.activeTurnId).toBe("u1");
        expect(context.replaceBlocks).toHaveBeenCalledWith([
          { type: "user", text: "first", id: "u1" },
        ]);
        expect(sessionManager.saveStore).toHaveBeenCalledWith(undefined, {
          final: true,
        });
      });

      it("bare /fork presents the picker (no domain handles)", async () => {
        const context = makeForkContext();
        const { ctx } = makeCtx({ context });

        await executeCommand("fork", [], ctx as CommandContext);

        expect(ctx.presentInput).toHaveBeenCalledWith({
          type: "fork-picker",
          messageIds: ["u1", "u2"],
          userMessages: ["first", "second"],
        });
      });

      it("/fork with an unknown-to-tree message reports an error", async () => {
        const context = makeForkContext();
        const sessionManager = makeSessionManagerMock(
          context,
          SessionTree.empty(),
        );
        const { ctx } = makeCtx({ context, sessionManager });

        await executeCommand("fork", ["1"], ctx as CommandContext);

        expect(sessionManager.reportStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "error",
            content: expect.stringContaining("not in the persisted tree"),
          }),
        );
      });

      it("/tree renders branches with the active path marked and numbered", async () => {
        const context = makeForkContext();
        const tree = SessionTree.empty();
        tree.appendTurn("u1", [{ type: "user", text: "first", id: "u1" }]);
        tree.appendTurn("u2", [{ type: "user", text: "second", id: "u2" }]);
        tree.setActiveTurn("u1"); // branch: u3 becomes u2's sibling
        tree.appendTurn("u3", [
          { type: "user", text: "  third  with\nnewlines ", id: "u3" },
        ]);
        const sessionManager = makeSessionManagerMock(context, tree);
        const { ctx } = makeCtx({ context, sessionManager });

        await executeCommand("tree", [], ctx as CommandContext);

        const content = (
          sessionManager.reportStatus as ReturnType<typeof vi.fn>
        ).mock.calls[0][0].content;
        expect(content).toContain('*1. "first"');
        expect(content).toContain('  "second"'); // branched off: no number
        expect(content).toContain('*2. "third with newlines"');
      });
    });

    it("/compress calls ctx.contextManager.compress() and reports status", async () => {
      const { ctx, sessionManager, contextManager } = makeCtx();

      const result = await executeCommand(
        "compress",
        [],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(contextManager.compress).toHaveBeenCalled();
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "status" }),
      );
    });

    it("/clear clears session and reports status", async () => {
      const { ctx, sessionManager, contextManager } = makeCtx();

      const result = await executeCommand("clear", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(sessionManager.clearSession).toHaveBeenCalled();
      expect(contextManager.reset).toHaveBeenCalled();
      expect(ctx.switchSession).toHaveBeenCalledWith(
        expect.stringMatching(/^session-/),
        { statusMessage: "(Cleared)" },
      );
    });

    it("/new creates new session and reports status", async () => {
      const { ctx, sessionManager, contextManager } = makeCtx();

      const result = await executeCommand(
        "new",
        ["my", "new", "session"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(sessionManager.clearSession).toHaveBeenCalled();
      expect(contextManager.reset).toHaveBeenCalled();
      expect(ctx.switchSession).toHaveBeenCalledWith("my new session", {
        statusMessage: "Created session: my new session",
      });
    });

    it("/rename renames session and reports status", async () => {
      const { ctx, sessionManager } = makeCtx();

      const result = await executeCommand(
        "rename",
        ["new-session"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(ctx.renameCurrentSession).toHaveBeenCalledWith("new-session");
    });

    it("/resume with no args lists sessions", async () => {
      sessionPersistenceMock.list.mockResolvedValue([
        { name: "session-1" },
        { name: "session-2" },
      ]);
      const { ctx } = makeCtx();

      const result = await executeCommand("resume", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(sessionPersistenceMock.list).toHaveBeenCalled();
      expect(ctx.presentInput).toHaveBeenCalledWith({
        type: "session-picker",
        sessions: [{ name: "session-1" }, { name: "session-2" }],
      });
    });

    it("/resume with args loads session", async () => {
      sessionPersistenceMock.load.mockResolvedValue({
        blocks: [],
        totalTokens: 100,
      });
      const { ctx } = makeCtx();

      const result = await executeCommand(
        "resume",
        ["session-1"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(ctx.resumeSession).toHaveBeenCalledWith("session-1");
    });

    it("/resume with unknown session shows error", async () => {
      const { ctx, sessionManager } = makeCtx();
      (ctx.resumeSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        loaded: false,
      });

      const result = await executeCommand(
        "resume",
        ["unknown"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: "error" }),
      );
    });

    it("/plan returns prompt text", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("plan", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(result.promptText).toContain("executable plan");
    });

    it("/test returns prompt text", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("test", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(result.promptText).toContain("smoke test of your available tools");
    });

    it("/effort with no args shows effort select UI", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand("effort", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(ctx.presentInput).toHaveBeenCalledWith({ type: "effort-picker" });
    });

    it("/effort with invalid value shows effort select UI", async () => {
      const { ctx } = makeCtx();
      const result = await executeCommand(
        "effort",
        ["invalid"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
      expect(ctx.presentInput).toHaveBeenCalledWith({ type: "effort-picker" });
    });

    it("/effort with valid value sets effort and reports status", async () => {
      const { ctx, sessionManager, model } = makeCtx();
      const result = await executeCommand(
        "effort",
        ["high"],
        ctx as CommandContext,
      );
      expect(result.kind).not.toBe("unknown");
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
      const { ctx, sessionManager } = makeCtx({
        skills: new SkillRegistry(),
      });

      const result = await executeCommand("skills", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
      expect(sessionManager.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "status",
          content: "(No skills available)",
        }),
      );
    });

    it("/skills with available skills renders skill list", async () => {
      const withSkills = new SkillRegistry();
      withSkills.register({
        name: "my-skill",
        description: "A custom skill",
        body: "body",
      });
      withSkills.register({
        name: "other",
        description: "Another one",
        body: "body",
      });
      const { ctx, sessionManager } = makeCtx({ skills: withSkills });

      const result = await executeCommand("skills", [], ctx as CommandContext);
      expect(result.kind).not.toBe("unknown");
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
      expect(result.kind).not.toBe("unknown");
      expect(ctx.presentInput).toHaveBeenCalledWith({
        type: "model-picker",
        providers: { anthropic: {}, openai: {} },
        tiers: {},
      });
    });

    it("getCommandList merges builtin and skill commands", () => {
      const list = getCommandList(commands, skills);
      const names = list.map((c) => c.name);
      expect(names).toContain("exit");
      expect(names).toContain("skill-creator");
    });
  });
});
