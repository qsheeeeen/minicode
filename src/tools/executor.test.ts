import { describe, it, expect, vi } from "vitest";
import { ToolExecutor, type ToolCall } from "./executor.js";
import { PermissionService } from "../services/permission.js";
import { LLMHistory } from "../llm/history.js";
import { ChangeJournal } from "../services/change-journal.js";
import type { ToolDef, ToolExecutionContext } from "./registry.js";
import { ToolDeniedError } from "./registry.js";

function makeTool(overrides?: Partial<ToolDef>): ToolDef {
  return {
    name: "testTool",
    description: "A test tool",
    input_schema: { type: "object" as const, properties: {} },
    execute: vi.fn().mockResolvedValue({ output: "ok" }),
    readOnly: true,
    ...overrides,
  };
}

function makeExecutor(overrides?: {
  tools?: Map<string, ToolDef>;
  permissionMode?: PermissionService["getMode"] extends () => infer R
    ? R
    : never;
  getChangeJournal?: () => ChangeJournal;
}) {
  const tools = overrides?.tools ?? new Map([["testTool", makeTool()]]);
  const permissionService = new PermissionService(
    overrides?.permissionMode ?? "yolo",
  );
  const context = new LLMHistory();
  const changeJournal = new ChangeJournal();
  const executor = new ToolExecutor({
    tools,
    permissionService,
    getChangeJournal: overrides?.getChangeJournal ?? (() => changeJournal),
    context,
  });
  return { executor, tools, permissionService, context, changeJournal };
}

function makeContext(): ToolExecutionContext {
  return {
    registry: undefined,
    config: {
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
    currentAgentId: "1",
    signal: undefined,
    prompter: undefined,
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

function prepareToolCalls(context: LLMHistory, calls: ToolCall[]): void {
  context.startTurn("task");
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

    it("stores permission service", () => {
      const { executor, permissionService } = makeExecutor();
      expect(executor.getPermissionService()).toBe(permissionService);
    });

    it("setPermissionMode delegates to service", () => {
      const { executor } = makeExecutor({ permissionMode: "manual" });
      executor.setPermissionMode("yolo");
      expect(executor.getPermissionService().getMode()).toBe("yolo");
    });
  });

  describe("execute", () => {
    it("does nothing with empty tool calls", async () => {
      const { executor, context } = makeExecutor();
      const spy = vi.spyOn(context, "completeToolCall");
      await executor.execute([], makeContext(), 1);
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

      await executor.execute([call], makeContext(), 1);

      expect(tool.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "ok");
    });

    it("handles tool not found", async () => {
      const { executor, context } = makeExecutor({ tools: new Map() });
      const call = makeToolCall(undefined);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      await executor.execute([call], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Error: Tool 'unknown' not found or not available.",
      );
    });

    it("throws ToolDeniedError when permission denied in manual mode", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        permissionMode: "manual",
      });

      // Mock permission service to deny
      vi.spyOn(executor.getPermissionService(), "check").mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);

      await expect(executor.execute([call], makeContext(), 1)).rejects.toThrow(
        ToolDeniedError,
      );
    });

    it("returns auto-gate denial message in auto mode", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        permissionMode: "auto",
      });
      const call = makeToolCall(tool);
      prepareToolCalls(context, [call]);
      const spy = vi.spyOn(context, "completeToolCall");

      vi.spyOn(executor.getPermissionService(), "check").mockResolvedValue({
        allowed: false,
        reason: "too risky",
      });

      await executor.execute([call], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith(
        "call_1",
        "Tool execution denied by auto-gate: too risky",
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

      await executor.execute([call], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith("call_1", "Error: boom");
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

      await executor.execute(calls, makeContext(), 1);

      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith("call_1", "ok");
      expect(spy).toHaveBeenCalledWith("call_2", "ok");
    });

    it("records tracked changes through the latest change journal getter", async () => {
      const tool = makeTool({
        readOnly: false,
        trackChanges: true,
        changeOp: "write",
      });
      const firstJournal = new ChangeJournal();
      const secondJournal = new ChangeJournal();
      const firstSpy = vi.spyOn(firstJournal, "recordBefore");
      const secondSpy = vi.spyOn(secondJournal, "recordBefore");
      let currentJournal = firstJournal;
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        getChangeJournal: () => currentJournal,
      });

      currentJournal = secondJournal;
      const call = makeToolCall(tool, { path: "/tmp/minicode-missing-file" });
      prepareToolCalls(context, [call]);
      await executor.execute([call], makeContext(), 1);

      expect(firstSpy).not.toHaveBeenCalled();
      expect(secondSpy).toHaveBeenCalledWith(
        1,
        "/tmp/minicode-missing-file",
        "write",
        "",
      );
    });
  });
});
