import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Model } from "./llm/model.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { PromptManager } from "./services/prompt-manager.js";
import { ToolExecutor } from "./tools/executor.js";
import { PermissionService } from "./services/permission.js";
import { SessionPersistence } from "./services/session-persistence.js";
import { Signal } from "./utils/signal.js";
import { getAll } from "./tools/index.js";

function makeTestModel() {
  // Use the mocked chatStream from the llm/client.js mock
  return new Model(
    { chatStream: mockChatStream } as any,
    "test-model",
    "test-provider",
    200000,
  );
}

function makeAgent(overrides?: {
  model?: Model;
  userPrompt?: string;
  compressionThresholdRatio?: number;
  permissionMode?: any;
}) {
  const o = overrides ?? {};
  const model = o.model ?? makeTestModel();
  const tokenCount$ = new Signal(0);
  const sessionManager = new SessionManager();
  const context = sessionManager.getContext();
  const contextManager = new ContextManager({
    contextLength: model.getContextLength(),
    compressionThresholdRatio: o.compressionThresholdRatio ?? 0.8,
    tokenCount$,
    contextManager: context,
    statusReporter: sessionManager.reportStatus.bind(sessionManager),
  });
  const promptManager = new PromptManager(o.userPrompt);
  const permissionService = new PermissionService(o.permissionMode ?? "manual");
  const toolExecutor = new ToolExecutor({
    tools: getAll(),
    permissionService,
    getChangeJournal: () => sessionManager.getChangeJournal(),
    context,
  });
  const agent = new Agent({
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
    tokenCount$,
  });
  return { agent, context, sessionManager, tokenCount$, permissionService };
}

class MockStream implements AsyncIterable<any> {
  private _promise: Promise<any>;
  resolveFinal!: (val: any) => void;
  rejectFinal!: (err: any) => void;

  private queue: IteratorResult<any>[] = [];
  private resolveNext: ((v: IteratorResult<any>) => void) | null = null;
  private isDone = false;

  constructor() {
    this._promise = new Promise((resolve, reject) => {
      this.resolveFinal = (val) => {
        this.end();
        resolve(val);
      };
      this.rejectFinal = reject;
    });
    // Prevent unhandled promise rejection warnings in tests
    this._promise.catch(() => {});
  }

  emit(event: string, payload: any) {
    const chunk =
      event === "tool_use"
        ? { type: "tool_use", block: payload }
        : { type: event, [event]: payload };
    if (this.resolveNext) {
      this.resolveNext({ value: chunk, done: false });
      this.resolveNext = null;
    } else {
      this.queue.push({ value: chunk, done: false });
    }
  }

  private end() {
    this.isDone = true;
    const fakeResponse = {
      usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 },
    };
    if (this.resolveNext) {
      this.resolveNext({ value: fakeResponse, done: true });
      this.resolveNext = null;
    }
  }

  async next() {
    if (this.queue.length > 0) return this.queue.shift()!;
    if (this.isDone)
      return {
        value: this._promise
          ? await this._promise.catch(() => undefined)
          : undefined,
        done: true,
      };
    return new Promise<IteratorResult<any>>((resolve) => {
      this.resolveNext = resolve;
    });
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  finalMessage() {
    return this._promise;
  }
  abort() {
    this.end();
    this.rejectFinal(new Error("Aborted"));
  }
}

const { mockChatStream } = vi.hoisted(() => ({
  mockChatStream: vi.fn(),
}));

vi.mock("./llm/client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    chatStream: mockChatStream,
  }),
}));

vi.mock("./tools/index.js", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  const testTool = {
    name: "testTool",
    description: "Test Tool",
    input_schema: { type: "object", properties: {} },
    requiresPermission: true,
    execute: vi.fn().mockResolvedValue({ output: "success" }),
  };
  return {
    ...original,
    getAll: () => new Map([[testTool.name, testTool]]),
    getSubAgentTools: () => new Map([[testTool.name, testTool]]),
  };
});

vi.mock("./services/token-tracker.js", () => ({
  TokenTracker: vi.fn().mockImplementation(function () {
    return {
      getTotal: vi.fn().mockReturnValue(100),
      processUsage: vi
        .fn()
        .mockReturnValue({ percentage: 10, shouldCompress: false }),
      reset: vi.fn(),
      setCount: vi.fn(),
      setContextLength: vi.fn(),
    };
  }),
}));

vi.mock("./services/compression-service.js", () => ({
  SummaryCompressionStrategy: vi.fn().mockImplementation(function () {
    return {
      compress: vi
        .fn()
        .mockResolvedValue([{ role: "user", content: "compressed" }]),
    };
  }),
}));

vi.mock("./services/permission.js", () => ({
  PermissionService: vi.fn().mockImplementation(function (_opts?: any) {
    let mode = "manual";
    return {
      check: vi.fn().mockResolvedValue({ allowed: true }),
      setMode: vi.fn().mockImplementation((m: string) => {
        mode = m;
      }),
      getMode: vi.fn().mockImplementation(() => mode),
      cycleMode: vi.fn(),
    };
  }),
}));

vi.mock("./utils/session.js", () => ({}));
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  },
}));

vi.mock("./cli/skills/index.js", () => ({
  skillRegistry: {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  },
}));

import { Agent } from "./agent.js";

describe("Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue("/tmp");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("initializes with default values", () => {
      const { agent } = makeAgent();
      expect(agent.currentSession).toMatch(/^session-\d+$/);
      expect(agent.tokenCount$.get()).toBe(0);
      expect(agent.model).toBeDefined();
    });

    it("initializes with config values", () => {
      const { agent, sessionManager } = makeAgent({ userPrompt: "custom" });
      sessionManager.setSession("test-session");
      expect(agent.currentSession).toBe("test-session");
    });
  });

  describe("getMessages and setMessages", () => {
    it("setMessages stores turns directly", () => {
      const { context, sessionManager } = makeAgent();
      const messages: any[] = [{ userText: "hello", process: [] }];
      sessionManager.setMessages(messages);
      expect(context.getTurns()).toEqual(messages);
    });

    it("getMessages returns context turns", () => {
      const { context } = makeAgent();
      context.startTurn("hello");
      expect(context.getTurns()).toEqual([{ userText: "hello", process: [] }]);
    });
  });

  describe("compress", () => {
    it("does not compress if not enough turns", async () => {
      const { agent, context, sessionManager } = makeAgent();
      const reportStatusSpy = vi.fn();
      sessionManager.setStatusReporter(reportStatusSpy);
      for (let i = 0; i < 5; i++) {
        context.startTurn(`msg ${i}`);
      }
      await agent.compress();
      expect(reportStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Not enough"),
        }),
      );
    });
  });

  describe("clearSession", () => {
    it("clears the context", () => {
      const { agent, context } = makeAgent();
      context.startTurn("hi");
      agent.clearSession();
      expect(context.getTurns()).toHaveLength(0);
    });
  });

  describe("run", () => {
    it("handles a basic text interaction", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const { agent, context } = makeAgent();
      const runPromise = agent.run("Hello agent");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("text", "Hi ");
      stream.emit("text", "there!");
      stream.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "end_turn",
      });

      await runPromise;
      const turns = context.getTurns();
      expect(turns).toEqual([
        { userText: "Hello agent", process: [], assistantText: "Hi there!" },
      ]);
    });

    it("handles thinking blocks", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const thinkingModel = new Model(
        { chatStream: mockChatStream } as any,
        "test-model",
        "test-provider",
        200000,
      );
      const { agent, context } = makeAgent({ model: thinkingModel });
      const runPromise = agent.run("Solve this");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("thinking", "Hmm...");
      stream.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "end_turn",
      });

      await runPromise;
      const turns = context.getTurns();
      expect(turns[0].process).toEqual([
        { type: "thinking", thinking: "Hmm..." },
      ]);
    });

    it("handles tool calls", async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream1).mockReturnValueOnce(stream2);

      const { agent, context } = makeAgent();
      const runPromise = agent.run("Use tool");
      await new Promise((r) => setTimeout(r, 10));

      stream1.emit("tool_use", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream1.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "tool_use",
      });

      setImmediate(() => {
        stream2.resolveFinal({
          usage: {
            input: { total: 10, cache_miss: 0, cache_hit: 0 },
            output: 20,
          },
          stop_reason: "end_turn",
        });
      });

      await runPromise;
      const turns = context.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].process).toEqual([
        {
          type: "tool_call",
          id: "call_1",
          name: "testTool",
          input: {},
          result: "success",
        },
      ]);
    });
  });

  describe("isRunning guard", () => {
    it("rejects concurrent run() calls, returns false", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const { agent } = makeAgent();
      const run1 = agent.run("First message");
      const run2 = agent.run("Second message");
      await expect(run2).resolves.toBe(false);
      stream.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "end_turn",
      });
      await run1;
      // After completion, new runs should work
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream2);
      const run3 = agent.run("Third message");
      stream2.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "end_turn",
      });
      await expect(run3).resolves.toBe(true);
    });
  });

  describe("abort", () => {
    it("aborts the current run", async () => {
      const stream = new MockStream();
      mockChatStream.mockImplementationOnce(
        (_msgs: any, _tools: any, opts: any) => {
          // Wire the AbortSignal to the mock stream's abort method
          opts?.signal?.addEventListener("abort", () => stream.abort());
          return stream;
        },
      );
      const { agent } = makeAgent();
      const runPromise = agent.run("Hello");
      await new Promise((r) => setTimeout(r, 10));
      agent.abort();
      await expect(runPromise).rejects.toThrow("Aborted");
    });
  });

  describe("rejection", () => {
    it("in manual mode, rejection stops the conversation", async () => {
      const { agent, context, sessionManager, permissionService } = makeAgent();
      const reportStatusSpy = vi.spyOn(sessionManager, "reportStatus");
      permissionService.setMode("manual");

      vi.mocked(permissionService.check).mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });

      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);

      const runPromise = agent.run("do something");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("tool_use", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "tool_use",
      });

      await runPromise;

      const turns = context.getTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].process).toEqual([
        {
          type: "tool_call",
          id: "call_1",
          name: "testTool",
          input: {},
          result: "User rejected",
        },
      ]);

      expect(reportStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "error",
          content: expect.stringContaining("denied by user"),
        }),
      );
    });

    it("in auto mode, rejection continues the conversation", async () => {
      const { agent, context, permissionService } = makeAgent();
      permissionService.setMode("auto");

      vi.mocked(permissionService.check).mockResolvedValue({
        allowed: false,
        reason: "too risky",
      });

      const stream1 = new MockStream();
      const stream2 = new MockStream();

      let callCount = 0;
      mockChatStream.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return stream1;
        if (callCount === 2) {
          setImmediate(() => {
            stream2.emit("text", "I cannot do that because it is too risky.");
            stream2.resolveFinal({
              usage: {
                input: { total: 5, cache_miss: 0, cache_hit: 0 },
                output: 10,
              },
              stop_reason: "end_turn",
            });
          });
          return stream2;
        }
        return new MockStream();
      });

      const runPromise = agent.run("do something risky");
      await new Promise((r) => setTimeout(r, 10));

      stream1.emit("tool_use", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream1.resolveFinal({
        usage: {
          input: { total: 10, cache_miss: 0, cache_hit: 0 },
          output: 20,
        },
        stop_reason: "tool_use",
      });

      await runPromise;

      const turns = context.getTurns();
      expect(turns).toHaveLength(1);
      expect((turns[0].process[0] as any).result).toContain(
        "Tool execution denied by auto-gate: too risky",
      );
      expect(turns[0].assistantText).toBe(
        "I cannot do that because it is too risky.",
      );
    });
  });
});
