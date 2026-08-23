import { describe, it, expect, vi } from "vitest";
import {
  ToolExecutor,
  type AfterToolCallHook,
  type BeforeToolCallHook,
  type ToolCall,
  type ToolExecutionDynamic,
} from "./executor.js";
import { LLMContext } from "../core/context.js";
import { createCapabilities, type ToolDef } from "./registry.js";

function makeTool(overrides?: Partial<ToolDef>): ToolDef {
  return {
    name: "testTool",
    description: "A test tool",
    input_schema: { type: "object" as const, properties: {} },
    execute: vi.fn().mockResolvedValue({ outcome: "success", result: "ok" }),
    readOnly: true,
    ...overrides,
  };
}

function makeExecutor(overrides?: {
  tools?: Map<string, ToolDef>;
  beforeHooks?: readonly BeforeToolCallHook[];
  afterHooks?: readonly AfterToolCallHook[];
}) {
  const tools = overrides?.tools ?? new Map([["testTool", makeTool()]]);
  const context = new LLMContext();
  const executor = new ToolExecutor({
    tools,
    beforeHooks: overrides?.beforeHooks,
    afterHooks: overrides?.afterHooks,
    context,
    capabilities: createCapabilities([]),
  });
  return { executor, tools, context };
}

function makeDynamic(): ToolExecutionDynamic {
  return {
    signal: new AbortController().signal,
    config: {
      client: {} as any,
      model: {
        getName: () => "test-model",
        getProvider: () => "test",
        getClient: () => ({}) as any,
        getContextLength: () => 200000,
        getEffort: () => undefined,
        setEffort: () => {},
        getDisplayName: () => "test",
      } as any,
      userPrompt: "",
    },
  };
}

function makeToolCall(
  tool: ToolDef | undefined,
  input: Record<string, unknown> = {},
  id = "call_1",
): ToolCall {
  return {
    block: {
      type: "tool_use" as const,
      id,
      name: tool?.name ?? "unknown",
      input,
    },
    tool,
  };
}

function prepareToolCalls(context: LLMContext, calls: ToolCall[]): void {
  context.startUserMessage("task");
  for (const call of calls) {
    context.startToolCall(call.block.id, call.block.name, call.block.input);
  }
}

describe("ToolExecutor", () => {
  describe("constructor and accessors", () => {
    it("stores tools", () => {
      const { executor, tools } = makeExecutor();
      expect(executor.getTools()).toBe(tools);
    });
  });

  describe("execute", () => {
    it("does nothing with empty tool calls", async () => {
      const { executor, context } = makeExecutor();
      const spy = vi.spyOn(context, "completeToolCall");
      await executor.execute([], makeDynamic());
      expect(spy).not.toHaveBeenCalled();
    });

    it("executes a tool and pushes result", async () => {
      const tool = makeTool();
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(tool.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "ok");
    });

    it("passes tool result images through to the context", async () => {
      const images = [{ mediaType: "image/png" as const, base64: "AAAA" }];
      const tool = makeTool({
        execute: vi
          .fn()
          .mockResolvedValue({ outcome: "success", result: "ok", images }),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith("call_1", "ok", images);
    });

    it("handles tool not found", async () => {
      const { executor, context } = makeExecutor({ tools: new Map() });
      const call = makeToolCall(undefined);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: Tool 'unknown' not found or not available.",
      );
    });

    it("a blocked call fails alone: Error result written, tool not executed, batch continues", async () => {
      const tool1 = makeTool({
        name: "tool1",
        readOnly: false,
        requiresPermission: true,
      });
      const tool2 = makeTool({ name: "tool2" });
      const beforeHooks: BeforeToolCallHook[] = [
        async (call) =>
          call.tool.name === "tool1"
            ? { block: true, reason: "User rejected" }
            : undefined,
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
        beforeHooks,
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute(calls, makeDynamic());

      expect(result).toBeNull(); // batch not aborted
      expect(tool1.execute).not.toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "Error: User rejected");
      expect(spy).toHaveBeenCalledWith("call_2", "ok");
    });

    it("runs before hooks serially, in call order", async () => {
      const events: string[] = [];
      const tool1 = makeTool({
        name: "tool1",
        readOnly: false,
        requiresPermission: true,
      });
      const tool2 = makeTool({
        name: "tool2",
        readOnly: false,
        requiresPermission: true,
      });
      const beforeHooks: BeforeToolCallHook[] = [
        async (call) => {
          events.push(`start:${call.tool.name}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          events.push(`end:${call.tool.name}`);
          return undefined;
        },
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
        beforeHooks,
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);

      await executor.execute(calls, makeDynamic());

      expect(events).toEqual([
        "start:tool1",
        "end:tool1",
        "start:tool2",
        "end:tool2",
      ]);
    });

    it("writes the block reason verbatim after the Error: prefix", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const beforeHooks: BeforeToolCallHook[] = [
        async () => ({
          block: true as const,
          reason: "Tool execution denied by auto-gate: too risky",
        }),
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        beforeHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: Tool execution denied by auto-gate: too risky",
      );
    });

    it("short-circuits remaining hooks after the first block", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const second = vi.fn(async () => undefined);
      const beforeHooks: BeforeToolCallHook[] = [
        async () => ({ block: true as const, reason: "no" }),
        second,
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        beforeHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);

      await executor.execute([call], makeDynamic());

      expect(second).not.toHaveBeenCalled();
    });

    it("degrades a throwing before hook to a block", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const beforeHooks: BeforeToolCallHook[] = [
        async () => {
          throw new Error("gate crashed");
        },
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        beforeHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute([call], makeDynamic());

      expect(result).toBeNull();
      expect(tool.execute).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: beforeToolCall hook failed: gate crashed",
      );
    });

    it("returns denied when a tool itself denies", async () => {
      const tool = makeTool({
        execute: vi
          .fn()
          .mockResolvedValue({ outcome: "denied", reason: "User cancelled" }),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute([call], makeDynamic());

      expect(result).toBe("denied");
      expect(spy).toHaveBeenCalledWith("call_1", "User cancelled");
    });

    it("applies after hooks to executed results before writing back", async () => {
      const tool = makeTool();
      const afterHooks: AfterToolCallHook[] = [
        async (_call, result) =>
          result.outcome === "success"
            ? { outcome: "success", result: "rewritten" }
            : undefined,
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        afterHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith("call_1", "rewritten");
    });

    it("chains after hooks, each receiving the previous result", async () => {
      const seen: string[] = [];
      const tool = makeTool();
      const afterHooks: AfterToolCallHook[] = [
        async (_call, result) => {
          seen.push(result.outcome);
          return { outcome: "error", reason: "first hook rewrote it" };
        },
        async (_call, result) => {
          seen.push(result.outcome);
          return undefined;
        },
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        afterHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(seen).toEqual(["success", "error"]);
      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: first hook rewrote it",
      );
    });

    it("keeps the original result when an after hook throws", async () => {
      const tool = makeTool();
      const afterHooks: AfterToolCallHook[] = [
        async () => {
          throw new Error("observer crashed");
        },
      ];
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        afterHooks,
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith("call_1", "ok");
    });

    it("does not run after hooks for blocked calls", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const after = vi.fn(async () => undefined);
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        beforeHooks: [async () => ({ block: true as const, reason: "no" })],
        afterHooks: [after],
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);

      await executor.execute([call], makeDynamic());

      expect(after).not.toHaveBeenCalled();
    });

    it("handles tool execution error", async () => {
      const tool = makeTool();
      (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("boom"),
      );
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith("call_1", "Error: boom");
    });

    it("propagates AbortError instead of converting it to a tool error", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      const tool = makeTool();
      (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(abortError);
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);

      await expect(
        executor.execute([call], makeDynamic()),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("aborts even when a tool ignores its signal and never settles", async () => {
      const tool = makeTool({
        execute: vi.fn(() => new Promise(() => {})),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const ctrl = new AbortController();
      const execution = executor.execute([call], {
        ...makeDynamic(),
        signal: ctrl.signal,
      });

      ctrl.abort();

      await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    });

    it("treats non-fatal failure as soft: writes reason back and continues the batch", async () => {
      const tool1 = makeTool({ name: "tool1" });
      (tool1.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: "error",
        reason: "file not found",
      });
      const tool2 = makeTool({ name: "tool2" });
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute(calls, makeDynamic());

      expect(result).toBeNull(); // batch not aborted
      expect(tool2.execute).toHaveBeenCalled(); // subsequent tool still ran
      expect(spy).toHaveBeenCalledWith("call_1", "Error: file not found");
      expect(spy).toHaveBeenCalledWith("call_2", "ok");
    });

    it("executes multiple tools in parallel", async () => {
      let markSecondStarted!: () => void;
      const secondStarted = new Promise<void>((resolve) => {
        markSecondStarted = resolve;
      });
      const order: string[] = [];
      const tool1 = makeTool({
        name: "tool1",
        execute: vi.fn(async () => {
          order.push("1");
          await secondStarted;
          return { outcome: "success", result: "1" };
        }),
      });
      const tool2 = makeTool({
        name: "tool2",
        execute: vi.fn(async () => {
          order.push("2");
          markSecondStarted();
          return { outcome: "success", result: "2" };
        }),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);

      await Promise.race([
        executor.execute(calls, makeDynamic()),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("tools did not run in parallel")),
            500,
          ),
        ),
      ]);

      expect(order).toEqual(["1", "2"]);
      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
    });

    it("writes tool results in original order when executions finish out of order", async () => {
      const tool1 = makeTool({
        name: "tool1",
        execute: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { outcome: "success", result: "slow" };
        }),
      });
      const tool2 = makeTool({
        name: "tool2",
        execute: vi.fn(async () => ({
          outcome: "success",
          result: "fast",
        })),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute(calls, makeDynamic());

      expect(spy.mock.calls.map((c) => c[0])).toEqual(["call_1", "call_2"]);
      expect(spy.mock.calls.map((c) => c[1])).toEqual(["slow", "fast"]);
    });

    it("blocks each call independently when every call is gated", async () => {
      const tool1 = makeTool({
        name: "tool1",
        readOnly: false,
        requiresPermission: true,
      });
      const tool2 = makeTool({
        name: "tool2",
        readOnly: false,
        requiresPermission: true,
      });
      const hook = vi.fn(
        async (call: Parameters<BeforeToolCallHook>[0]) =>
          call.tool.name === "tool2"
            ? { block: true as const, reason: "User rejected" }
            : undefined,
      );
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
        beforeHooks: [hook],
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute(calls, makeDynamic());

      expect(result).toBeNull();
      expect(hook).toHaveBeenCalledTimes(2);
      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).not.toHaveBeenCalled();
      expect(spy.mock.calls.map((c) => c[0])).toEqual(["call_1", "call_2"]);
      expect(spy.mock.calls.map((c) => c[1])).toEqual(["ok", "Error: User rejected"]);
    });

    it("runs a batch sequentially when it contains a sequential tool", async () => {
      const events: string[] = [];
      const tool1 = makeTool({
        name: "tool1",
        executionMode: "sequential",
        execute: vi.fn(async () => {
          events.push("1:start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push("1:end");
          return { outcome: "success", result: "1" };
        }),
      });
      const tool2 = makeTool({
        name: "tool2",
        execute: vi.fn(async () => {
          events.push("2");
          return { outcome: "success", result: "2" };
        }),
      });
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute(calls, makeDynamic());

      expect(events).toEqual(["1:start", "1:end", "2"]);
      expect(spy.mock.calls.map((c) => c[1])).toEqual(["1", "2"]);
    });

    it("executes multiple tools", async () => {
      const tool1 = makeTool({ name: "tool1" });
      const tool2 = makeTool({ name: "tool2" });
      const { executor, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute(calls, makeDynamic());

      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "ok");
      expect(spy).toHaveBeenCalledWith("call_2", "ok");
    });
  });
});
