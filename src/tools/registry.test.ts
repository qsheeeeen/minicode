import { describe, it, expect } from "vitest";
import { register, getAll, getSubAgentTools } from "./registry.js";
import type { ToolDef } from "./index.js";

describe("register", () => {
  it("adds tool to registry", () => {
    const tool: ToolDef = {
      name: "reg-test",
      description: "A test tool",
      input_schema: { type: "object", properties: {} },
      execute: async () => ({ output: "ok" }),
    };
    register(tool);
    expect(getAll().get("reg-test")).toBe(tool);
  });

  it("overwrites existing tool with same name", () => {
    const tool1: ToolDef = {
      name: "overwrite-test",
      description: "Tool 1",
      input_schema: { type: "object", properties: {} },
      execute: async () => ({ output: "ok" }),
    };
    const tool2: ToolDef = {
      name: "overwrite-test",
      description: "Tool 2",
      input_schema: { type: "object", properties: {} },
      execute: async () => ({ output: "changed" }),
    };
    register(tool1);
    register(tool2);
    expect(getAll().get("overwrite-test")?.description).toBe("Tool 2");
  });
});

describe("all", () => {
  it("returns all registered tools as Map", () => {
    const tools = getAll();
    expect(tools).toBeInstanceOf(Map);
    expect(tools.size).toBeGreaterThan(0);
  });

  it("returns a copy (mutations don't affect source)", () => {
    const tools = getAll();
    const sizeBefore = getAll().size;
    tools.delete("Read");
    expect(getAll().size).toBe(sizeBefore);
  });
});

describe("subAgentTools", () => {
  it("returns only read-only non-interactive tools", () => {
    const safe = getSubAgentTools();
    expect(safe).toBeInstanceOf(Map);
    for (const tool of safe.values()) {
      expect(tool.readOnly ?? !tool.requiresPermission).toBe(true);
      expect(tool.interactive).toBeFalsy();
    }
  });
});
