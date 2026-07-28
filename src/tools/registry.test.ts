import { describe, it, expect } from "vitest";
import {
  register,
  getAll,
  getSubAgentTools,
  capability,
  createCapabilities,
} from "./registry.js";
import type { ToolDef } from "./index.js";
import "./index.js"; // load built-in tools so registry tests run against real data

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
  it("returns only read-only non-interactive tools by default", () => {
    const safe = getSubAgentTools();
    expect(safe).toBeInstanceOf(Map);
    for (const tool of safe.values()) {
      expect(tool.readOnly ?? !tool.requiresPermission).toBe(true);
      expect(tool.interactive).toBeFalsy();
    }
    expect(safe.has("SubAgent")).toBe(false);
  });

  it("readOnly:false includes write tools (superset of default)", () => {
    const safe = getSubAgentTools();
    const all = getSubAgentTools({ readOnly: false });
    for (const name of safe.keys()) expect(all.has(name)).toBe(true);
    expect(all.size).toBeGreaterThanOrEqual(safe.size);
    // still excludes SubAgent and interactive tools
    expect(all.has("SubAgent")).toBe(false);
    for (const tool of all.values()) expect(tool.interactive).toBeFalsy();
  });

  it("allowlist takes precedence and returns only named tools", () => {
    const allowed = getSubAgentTools({ allowlist: ["Read", "Grep"] });
    expect([...allowed.keys()].sort()).toEqual(["Grep", "Read"]);
  });
});

describe("capabilities", () => {
  it("createCapabilities resolves a registered service by key", () => {
    const Foo = capability<string>("foo");
    const caps = createCapabilities([[Foo, "bar"]]);
    expect(caps.get(Foo)).toBe("bar");
  });

  it("get returns undefined for an unregistered capability", () => {
    const Foo = capability<string>("foo");
    expect(createCapabilities([]).get(Foo)).toBeUndefined();
  });

  it("different capability names are independent", () => {
    const Foo = capability<string>("foo");
    const Bar = capability<number>("bar");
    const caps = createCapabilities([
      [Foo, "x"],
      [Bar, 42],
    ]);
    expect(caps.get(Foo)).toBe("x");
    expect(caps.get(Bar)).toBe(42);
  });
});
