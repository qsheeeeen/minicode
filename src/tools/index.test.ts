import { describe, it, expect } from "vitest";
import { createDefaultToolRegistry } from "./index.js";

describe("tool registry", () => {
  it("creates a registry with all built-in tools", () => {
    const tools = createDefaultToolRegistry().getAll();
    expect(tools.size).toBeGreaterThan(0);
    expect(tools.has("Read")).toBe(true);
    expect(tools.has("Write")).toBe(true);
    expect(tools.has("Edit")).toBe(true);
    expect(tools.has("Shell")).toBe(true);
    expect(tools.has("Grep")).toBe(true);
    expect(tools.has("SubAgent")).toBe(true);
  });

  it("getSubAgentTools() returns only read-only non-interactive tools", () => {
    const safe = createDefaultToolRegistry().getSubAgentTools();
    const names = [...safe.keys()];
    expect(names).toContain("Read");
    expect(names).toContain("Grep");
    expect(names).toContain("LoadSkill");
    expect(names).not.toContain("Shell");
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("AskUser");
    expect(names).not.toContain("SubAgent");
  });

  it("getAll() returns a Map copy", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.getAll()).toBeInstanceOf(Map);
  });

  it("tools have required properties", () => {
    for (const [name, tool] of createDefaultToolRegistry().getAll()) {
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe("string");
      expect(tool.input_schema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("fresh instances do not share registrations", () => {
    const a = createDefaultToolRegistry();
    const b = createDefaultToolRegistry();
    b.register({
      name: "OnlyInB",
      description: "d",
      input_schema: {},
      execute: async () => ({ outcome: "success", result: "ok" }),
    });
    expect(a.get("OnlyInB")).toBeUndefined();
    expect(b.get("OnlyInB")).toBeDefined();
  });
});
