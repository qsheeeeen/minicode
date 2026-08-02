import { describe, it, expect, vi } from "vitest";
import {
  ToolExecutor,
  type ToolCall,
  type ToolExecutionDynamic,
} from "./executor.js";
import { PermissionService } from "../services/permission.js";
import { LLMContext } from "../llm/context.js";
import { createCapabilities, type ToolDef } from "./registry.js";

vi.mock("../utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));

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
  permissionMode?: PermissionService["getMode"] extends () => infer R
    ? R
    : never;
}) {
  const tools = overrides?.tools ?? new Map([["testTool", makeTool()]]);
  const permissionService = new PermissionService(
    overrides?.permissionMode ?? "yolo",
  );
  const context = new LLMContext();
  const executor = new ToolExecutor({
    tools,
    permissionService,
    context,
    capabilities: createCapabilities([]),
  });
  return { executor, tools, permissionService, context };
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

    it("returns a denial when permission denied in manual mode", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const { executor, permissionService, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        permissionMode: "manual",
      });

      // Mock permission service to deny
      vi.spyOn(permissionService, "check").mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);

      const result = await executor.execute([call], makeDynamic());

      expect(result).toBe("denied");
    });

    it("denies the rest of the batch when one tool is denied", async () => {
      const tool1 = makeTool({
        name: "tool1",
        readOnly: false,
        requiresPermission: true,
      });
      const tool2 = makeTool({ name: "tool2" });
      const { executor, permissionService, context } = makeExecutor({
        tools: new Map([
          ["tool1", tool1],
          ["tool2", tool2],
        ]),
        permissionMode: "manual",
      });

      vi.spyOn(permissionService, "check").mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });
      const calls = [
        makeToolCall(tool1, {}, "call_1"),
        makeToolCall(tool2, {}, "call_2"),
      ];
      prepareToolCalls(context, calls);
      const spy = vi.spyOn(context, "completeToolCall");

      const result = await executor.execute(calls, makeDynamic());

      expect(result).toBe("denied");
      expect(tool2.execute).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "User rejected");
      expect(spy).toHaveBeenCalledWith("call_2", "User rejected");
    });

    it("returns auto-gate denial message in auto mode", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const { executor, permissionService, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        permissionMode: "auto",
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      vi.spyOn(permissionService, "check").mockResolvedValue({
        allowed: false,
        reason: "too risky",
      });

      await executor.execute([call], makeDynamic());

      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: Tool execution denied by auto-gate: too risky",
      );
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

    it("executes multiple tools sequentially", async () => {
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
