import { describe, it, expect, vi } from "vitest";
import { ToolExecutor, type ToolCall } from "./executor.js";
import { PermissionService } from "../services/permission.js";
import { LLMContextManager } from "../context/index.js";
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
  const context = new LLMContextManager();
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
): ToolCall {
  return {
    block: {
      type: "tool_use" as const,
      id: "call_1",
      name: tool?.name ?? "unknown",
      input,
    },
    tool,
  };
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
      const spy = vi.spyOn(context, "addToolResults");
      await executor.execute([], makeContext(), 1);
      expect(spy).not.toHaveBeenCalled();
    });

    it("executes a tool and pushes result", async () => {
      const tool = makeTool();
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const spy = vi.spyOn(context, "addToolResults");

      await executor.execute([makeToolCall(tool)], makeContext(), 1);

      expect(tool.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith([
        { toolUseId: "call_1", content: "ok" },
      ]);
    });

    it("handles tool not found", async () => {
      const { executor, context } = makeExecutor({ tools: new Map() });
      const spy = vi.spyOn(context, "addToolResults");

      await executor.execute([makeToolCall(undefined)], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith([
        {
          toolUseId: "call_1",
          content: "Error: Tool 'unknown' not found or not available.",
        },
      ]);
    });

    it("throws ToolDeniedError when permission denied in manual mode", async () => {
      const tool = makeTool({
        readOnly: false,
        requiresPermission: true,
      });
      const { executor } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        permissionMode: "manual",
      });

      // Mock permission service to deny
      vi.spyOn(executor.getPermissionService(), "check").mockResolvedValue({
        allowed: false,
        reason: "User rejected",
      });

      await expect(
        executor.execute([makeToolCall(tool)], makeContext(), 1),
      ).rejects.toThrow(ToolDeniedError);
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
      const spy = vi.spyOn(context, "addToolResults");

      vi.spyOn(executor.getPermissionService(), "check").mockResolvedValue({
        allowed: false,
        reason: "too risky",
      });

      await executor.execute([makeToolCall(tool)], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith([
        {
          toolUseId: "call_1",
          content: "Tool execution denied by auto-gate: too risky",
        },
      ]);
    });

    it("handles tool execution error", async () => {
      const tool = makeTool();
      (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("boom"),
      );
      const { executor, context } = makeExecutor({
        tools: new Map([["testTool", tool]]),
      });
      const spy = vi.spyOn(context, "addToolResults");

      await executor.execute([makeToolCall(tool)], makeContext(), 1);

      expect(spy).toHaveBeenCalledWith([
        { toolUseId: "call_1", content: "Error: boom" },
      ]);
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
      const spy = vi.spyOn(context, "addToolResults");

      await executor.execute(
        [makeToolCall(tool1), makeToolCall(tool2)],
        makeContext(),
        1,
      );

      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith([
        { toolUseId: "call_1", content: "ok" },
        { toolUseId: "call_1", content: "ok" },
      ]);
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
      const { executor } = makeExecutor({
        tools: new Map([["testTool", tool]]),
        getChangeJournal: () => currentJournal,
      });

      currentJournal = secondJournal;
      await executor.execute(
        [makeToolCall(tool, { path: "/tmp/minicode-missing-file" })],
        makeContext(),
        1,
      );

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
