import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Model } from "./llm/model.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { RuntimeEvents } from "./services/runtime-events.js";
import { PromptManager } from "./services/prompt-manager.js";
import { ToolExecutor } from "./tools/executor.js";
import { PermissionService } from "./services/permission.js";
import { SessionPersistence } from "./services/session-persistence.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import { createCapabilities } from "./tools/registry.js";

function makeTestModel() {
  return new Model("test-model", "test-provider", 200000);
}

function makeDeps(overrides?: {
  client?: any;
  model?: Model;
  userPrompt?: string;
  compressionThresholdRatio?: number;
  permissionMode?: any;
}) {
  const o = overrides ?? {};
  const client = o.client ?? ({ chatStream: mockChatStream } as any);
  const model = o.model ?? makeTestModel();
  const runtimeEvents = new RuntimeEvents();
  const sessionManager = new SessionManager(
    undefined,
    undefined,
    runtimeEvents,
  );
  const context = sessionManager.getContext();
  const contextManager = new ContextManager({
    getClient: () => client,
    getModel: () => model,
    getContext: () => sessionManager.getContext(),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    setActiveUserMessageOrdinal: (ordinal) =>
      sessionManager.setActiveUserMessageOrdinal(ordinal),
    events: runtimeEvents,
    compressionThresholdRatio: o.compressionThresholdRatio ?? 0.8,
  });
  const promptManager = new PromptManager(o.userPrompt);
  const permissionService = new PermissionService(o.permissionMode ?? "manual");
  const toolExecutor = new ToolExecutor({
    tools: createDefaultToolRegistry().getAll(),
    permissionService,
    context,
    capabilities: createCapabilities([]),
  });
  const deps: AgentDeps = {
    client,
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };
  return { deps, context, sessionManager, contextManager, permissionService };
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
        resolve({ ok: true, ...val });
      };
      this.rejectFinal = reject;
    });
    // Prevent unhandled promise rejection warnings in tests
    this._promise.catch(() => {});
  }

  emit(event: string, payload: any) {
    const chunk =
      event === "tool_use" ? payload : { type: event, [event]: payload };
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
      ok: true as const,
      stop_reason: "end_turn" as const,
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
    execute: vi
      .fn()
      .mockResolvedValue({ outcome: "success", result: "success" }),
  };
  return {
    ...original,
    createDefaultToolRegistry: () => ({
      getAll: () => new Map([[testTool.name, testTool]]),
      get: () => undefined,
      getSubAgentTools: () => new Map([[testTool.name, testTool]]),
      reset: () => {},
    }),
  };
});

vi.mock("./services/compression-service.js", () => ({
  SummaryCompressionStrategy: vi.fn().mockImplementation(function () {
    return {
      compress: vi
        .fn()
        .mockResolvedValue([{ type: "user", text: "compressed" }]),
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
vi.mock("./utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));
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

import { runAgent, type AgentDeps } from "./agent.js";

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue("/tmp");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("deps assembly", () => {
    it("initializes with default values", () => {
      const { sessionManager, contextManager, deps } = makeDeps();
      expect(sessionManager.getSessionName()).toMatch(/^session-\d+$/);
      expect(contextManager.getTokenCount()).toBe(0);
      expect(deps.model).toBeDefined();
    });

    it("initializes with config values", () => {
      const { sessionManager } = makeDeps({ userPrompt: "custom" });
      sessionManager.setSession("test-session");
      expect(sessionManager.getSessionName()).toBe("test-session");
    });
  });

  describe("run", () => {
    it("handles a basic text interaction", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const { deps, context } = makeDeps();
      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "Hello agent", ctrl.signal);
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
      const blocks = context.getBlocks();
      expect(blocks).toEqual([
        { type: "user", text: "Hello agent" },
        { type: "text", text: "Hi there!" },
      ]);
    });

    it("handles thinking blocks", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const thinkingModel = new Model("test-model", "test-provider", 200000);
      const { deps, context } = makeDeps({ model: thinkingModel });
      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "Solve this", ctrl.signal);
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
      const blocks = context.getBlocks();
      expect(blocks).toEqual([
        { type: "user", text: "Solve this" },
        { type: "thinking", thinking: "Hmm..." },
      ]);
    });

    it("handles tool calls", async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream1).mockReturnValueOnce(stream2);

      const { deps, context } = makeDeps();
      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "Use tool", ctrl.signal);
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
      const blocks = context.getBlocks();
      expect(blocks).toEqual([
        { type: "user", text: "Use tool" },
        {
          type: "tool_use",
          id: "call_1",
          name: "testTool",
          input: {},
        },
        { type: "tool_result", tool_use_id: "call_1", content: "success" },
      ]);
    });
  });

  describe("abort", () => {
    it("aborts the current run via the passed signal", async () => {
      const stream = new MockStream();
      mockChatStream.mockImplementationOnce(
        (_msgs: any, _tools: any, opts: any) => {
          // Wire the AbortSignal to the mock stream's abort method
          opts?.signal?.addEventListener("abort", () => stream.abort());
          return stream;
        },
      );
      const { deps } = makeDeps();
      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "Hello", ctrl.signal);
      await new Promise((r) => setTimeout(r, 10));
      ctrl.abort();
      await expect(runPromise).rejects.toMatchObject({ name: "AbortError" });
    });

    it("aborts even when the provider stream never settles", async () => {
      const hangingStream = {
        next: () => new Promise(() => {}),
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      mockChatStream.mockReturnValueOnce(hangingStream as any);
      const { deps } = makeDeps();
      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "Hello", ctrl.signal);
      await new Promise((resolve) => setTimeout(resolve, 10));
      ctrl.abort();

      await expect(
        Promise.race([
          runPromise,
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("abort did not interrupt a stalled stream")),
              500,
            ),
          ),
        ]),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("rejection", () => {
    it("in manual mode, rejection stops the conversation", async () => {
      const { deps, context, permissionService } = makeDeps();
      permissionService.setMode("manual");

      vi.mocked(permissionService.check).mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });

      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);

      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "do something", ctrl.signal);
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

      const blocks = context.getBlocks();
      expect(blocks).toEqual([
        { type: "user", text: "do something" },
        {
          type: "tool_use",
          id: "call_1",
          name: "testTool",
          input: {},
        },
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: "User rejected",
        },
      ]);
    });

    it("in auto mode, rejection continues the conversation", async () => {
      const { deps, context, permissionService } = makeDeps();
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

      const ctrl = new AbortController();
      const runPromise = runAgent(deps, "do something risky", ctrl.signal);
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

      const blocks = context.getBlocks();
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: "tool_result",
          tool_use_id: "call_1",
          content: expect.stringContaining(
            "Tool execution denied by auto-gate: too risky",
          ),
        }),
      );
      expect(blocks).toContainEqual({
        type: "text",
        text: "I cannot do that because it is too risky.",
      });
    });
  });
});
