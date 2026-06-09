import { describe, it, expect } from "vitest";
import { getAll, getSubAgentTools } from "./index.js";

describe("tool registry", () => {
  it("getAll() returns self-registered tools", () => {
    const tools = getAll();
    expect(tools.size).toBeGreaterThan(0);
    expect(tools.has("Read")).toBe(true);
    expect(tools.has("Write")).toBe(true);
    expect(tools.has("Edit")).toBe(true);
    expect(tools.has("Bash")).toBe(true);
    expect(tools.has("Grep")).toBe(true);
    expect(tools.has("SubAgent")).toBe(true);
  });

  it("getSubAgentTools() returns only read-only non-interactive tools", () => {
    const safe = getSubAgentTools();
    const names = [...safe.keys()];
    expect(names).toContain("Read");
    expect(names).toContain("Grep");
    expect(names).toContain("LoadSkill");
    expect(names).not.toContain("Bash");
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("AskUser");
    expect(names).not.toContain("SubAgent");
  });

  it("getAll() returns a Map copy", () => {
    const tools = getAll();
    expect(tools).toBeInstanceOf(Map);
  });

  it("tools have required properties", () => {
    for (const [name, tool] of getAll()) {
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe("string");
      expect(tool.input_schema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });
});
