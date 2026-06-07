import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

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
      event === "contentBlock"
        ? { type: "contentBlock", block: payload }
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
    const fakeResponse = { usage: { input_tokens: 10, output_tokens: 10 } };
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
  const actual: any = await importOriginal();
  const testTool = {
    name: "testTool",
    description: "Test Tool",
    input_schema: { type: "object", properties: {} },
    requiresPermission: true,
    execute: vi.fn().mockResolvedValue({ output: "success" }),
  };
  return {
    ...actual,
    getAll: () => new Map([[testTool.name, testTool]]),
    getSubAgentTools: () => new Map([[testTool.name, testTool]]),
  };
});

vi.mock("./services/token-counter.js", () => ({
  TokenCounter: vi.fn().mockImplementation(function () {
    return {
      getTotal: vi.fn().mockReturnValue(100),
      updateUsage: vi.fn(),
      getRatio: vi.fn().mockReturnValue(0.1),
      getLastShownThreshold: vi.fn().mockReturnValue(0),
      updateThreshold: vi.fn(),
      shouldCompress: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
    };
  }),
}));

vi.mock("./services/compression-service.js", () => ({
  CompressionService: vi.fn().mockImplementation(function () {
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
      setPrompter: vi.fn(),
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
import { MessageStore } from "./messages.js";

describe("Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("initializes with default values", () => {
      const agent = new Agent();
      expect(agent.currentSession).toMatch(/^session-\d+$/);
      expect(agent.getTokenCount()).toBe(100);
      expect(agent.getStore()).toBeInstanceOf(MessageStore);
    });

    it("initializes with config values", () => {
      const agent = new Agent({ userPrompt: "custom" });
      agent.setSession("test-session");
      expect(agent.currentSession).toBe("test-session");
    });
  });

  describe("getMessages and setMessages", () => {
    it("setMessages stores turns directly", () => {
      const agent = new Agent();
      const messages: any[] = [{ role: "user", content: "hello" }];
      agent.setMessages(messages);
      expect(agent.getMessages()).toEqual(messages);
      expect(agent.getStore().getTurns()).toEqual(messages);
    });

    it("getMessages returns store turns", () => {
      const agent = new Agent();
      agent.getStore().addUserMessage("hello");
      expect(agent.getMessages()).toEqual([{ role: "user", content: "hello" }]);
    });
  });

  describe("compress", () => {
    it("does not compress if not enough turns", async () => {
      const agent = new Agent();
      for (let i = 0; i < 5; i++) {
        agent.getStore().addUserMessage(`msg ${i}`);
      }
      await agent.compress();
      const statuses = agent.getStore().getStatuses();
      expect(statuses.some((s) => s.content.includes("Not enough"))).toBe(true);
    });
  });

  describe("clearSession", () => {
    it("clears the store", () => {
      const agent = new Agent();
      agent.getStore().addUserMessage("hi");
      agent.clearSession();
      expect(agent.getStore().getTurns()).toHaveLength(0);
    });
  });

  describe("run", () => {
    it("handles a basic text interaction", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const agent = new Agent();
      const runPromise = agent.run("Hello agent");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("text", "Hi ");
      stream.emit("text", "there!");
      stream.emit("contentBlock", { type: "text" });
      stream.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      });

      await runPromise;
      const turns = agent.getStore().getTurns();
      expect(turns[0]).toEqual({ role: "user", content: "Hello agent" });
      expect(turns[1].role).toBe("assistant");
    });

    it("handles thinking blocks", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const agent = new Agent({ thinkingEnabled: true });
      const runPromise = agent.run("Solve this");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("thinking", "Hmm...");
      stream.emit("contentBlock", { type: "thinking" });
      stream.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      });

      await runPromise;
      const turns = agent.getStore().getTurns();
      const content = turns[1].content as any[];
      expect(content.some((b: any) => b.type === "thinking")).toBe(true);
    });

    it("handles tool calls", async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream1).mockReturnValueOnce(stream2);

      const agent = new Agent();
      const runPromise = agent.run("Use tool");
      await new Promise((r) => setTimeout(r, 10));

      stream1.emit("contentBlock", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream1.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "tool_use",
      });

      setImmediate(() => {
        stream2.resolveFinal({
          usage: { input_tokens: 10, output_tokens: 20 },
          stop_reason: "end_turn",
        });
      });

      await runPromise;
      const turns = agent.getStore().getTurns();
      const assistantContent = turns[1].content as any[];
      expect(assistantContent.some((b: any) => b.type === "tool_use")).toBe(
        true,
      );
      expect(turns[2].role).toBe("user");
      expect(Array.isArray(turns[2].content)).toBe(true);
    });
  });

  describe("isRunning guard", () => {
    it("rejects concurrent run() calls, returns false", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const agent = new Agent();
      const run1 = agent.run("First message");
      const run2 = agent.run("Second message");
      await expect(run2).resolves.toBe(false);
      stream.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      });
      await run1;
      // After completion, new runs should work
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream2);
      const run3 = agent.run("Third message");
      stream2.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      });
      await expect(run3).resolves.toBe(true);
    });
  });

  describe("abort", () => {
    it("aborts the current run", async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const agent = new Agent();
      const runPromise = agent.run("Hello");
      await new Promise((r) => setTimeout(r, 10));
      agent.abort();
      await expect(runPromise).rejects.toThrow("Aborted");
    });
  });

  describe("rejection", () => {
    it("in manual mode, rejection stops the conversation", async () => {
      const agent = new Agent();
      agent.setPermissionMode("manual");

      vi.mocked(agent.getPermissionService().check).mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });

      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);

      const runPromise = agent.run("do something");
      await new Promise((r) => setTimeout(r, 10));

      stream.emit("contentBlock", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "tool_use",
      });

      await runPromise;

      const turns = agent.getStore().getTurns();
      expect(turns).toHaveLength(3);
      const lastTurn = turns[2];
      expect(lastTurn.role).toBe("user");
      expect((lastTurn.content as any)[0].content).toBe("User rejected");

      const statuses = agent.getStore().getStatuses();
      expect(
        statuses.some(
          (s) => s.role === "error" && s.content.includes("denied by user"),
        ),
      ).toBe(true);
    });

    it("in auto mode, rejection continues the conversation", async () => {
      const agent = new Agent();
      agent.setPermissionMode("auto");

      vi.mocked(agent.getPermissionService().check).mockResolvedValue({
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
            stream2.emit("contentBlock", {
              type: "text",
              text: "I cannot do that because it is too risky.",
            });
            stream2.resolveFinal({
              usage: { input_tokens: 5, output_tokens: 10 },
              stop_reason: "end_turn",
            });
          });
          return stream2;
        }
        return new MockStream();
      });

      const runPromise = agent.run("do something risky");
      await new Promise((r) => setTimeout(r, 10));

      stream1.emit("contentBlock", {
        type: "tool_use",
        id: "call_1",
        name: "testTool",
        input: {},
      });
      stream1.resolveFinal({
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "tool_use",
      });

      await runPromise;

      const turns = agent.getStore().getTurns();
      expect(turns).toHaveLength(4);
      const toolResultTurn = turns[2];
      expect((toolResultTurn.content as any)[0].content).toContain(
        "Tool execution denied by auto-gate: too risky",
      );

      const finalTurn = turns[3];
      expect(finalTurn.role).toBe("assistant");
    });
  });
});
