import { describe, it, expect, vi } from "vitest";
import { createPermissionGate } from "./tool-gates.js";
import { PermissionService } from "../services/permission.js";
import type { ToolDef } from "../tools/registry.js";
import type { ToolExecutionContext } from "../tools/registry.js";
import type { ToolHookCall } from "../tools/executor.js";

vi.mock("../utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));

function makeTool(overrides?: Partial<ToolDef>): ToolDef {
  return {
    name: "gatedTool",
    description: "A gated tool",
    input_schema: { type: "object" as const, properties: {} },
    execute: vi.fn(),
    readOnly: false,
    requiresPermission: true,
    ...overrides,
  };
}

function makeCall(tool: ToolDef): ToolHookCall {
  const args = { a: 1 };
  return {
    block: { type: "tool_use", id: "c1", name: tool.name, input: args },
    tool,
    args,
  };
}

const ctx = {} as ToolExecutionContext;

describe("createPermissionGate", () => {
  it("lets read-only tools through without asking", async () => {
    const ps = new PermissionService("manual");
    const check = vi.spyOn(ps, "check");
    const gate = createPermissionGate(ps);

    const verdict = await gate(
      makeCall(makeTool({ readOnly: true })),
      ctx,
    );

    expect(verdict).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("treats a tool without readOnly as permission-free when it does not require permission", async () => {
    const ps = new PermissionService("manual");
    const check = vi.spyOn(ps, "check");
    const gate = createPermissionGate(ps);

    const tool = makeTool();
    delete (tool as Partial<ToolDef>).readOnly;
    const verdict = await gate(makeCall({ ...tool, requiresPermission: false }), ctx);

    expect(verdict).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("passes through when the service allows", async () => {
    const ps = new PermissionService("manual");
    vi.spyOn(ps, "check").mockResolvedValue({ allowed: true });
    const gate = createPermissionGate(ps);

    expect(await gate(makeCall(makeTool()), ctx)).toBeUndefined();
  });

  it("blocks with the check reason when denied in manual mode", async () => {
    const ps = new PermissionService("manual");
    vi.spyOn(ps, "check").mockResolvedValue({
      allowed: false,
      reason: "User cancelled",
    });
    const gate = createPermissionGate(ps);

    expect(await gate(makeCall(makeTool()), ctx)).toEqual({
      block: true,
      reason: "User cancelled",
    });
  });

  it("falls back to 'User rejected' when a manual denial has no reason", async () => {
    const ps = new PermissionService("manual");
    vi.spyOn(ps, "check").mockResolvedValue({ allowed: false });
    const gate = createPermissionGate(ps);

    expect(await gate(makeCall(makeTool()), ctx)).toEqual({
      block: true,
      reason: "User rejected",
    });
  });

  it("wraps auto-gate denials with the standard prefix", async () => {
    const ps = new PermissionService("auto");
    vi.spyOn(ps, "check").mockResolvedValue({
      allowed: false,
      reason: "too risky",
    });
    const gate = createPermissionGate(ps);

    expect(await gate(makeCall(makeTool()), ctx)).toEqual({
      block: true,
      reason: "Tool execution denied by auto-gate: too risky",
    });
  });

  it("uses 'unknown reason' for auto denials without a reason", async () => {
    const ps = new PermissionService("auto");
    vi.spyOn(ps, "check").mockResolvedValue({ allowed: false });
    const gate = createPermissionGate(ps);

    expect(await gate(makeCall(makeTool()), ctx)).toEqual({
      block: true,
      reason: "Tool execution denied by auto-gate: unknown reason",
    });
  });
});
