import { describe, it, expect } from "vitest";
import { ToolRegistry, all, subAgentTools } from "./index.js";

describe("tool registry", () => {
  it("all() returns self-registered tools", () => {
    const tools = all();
    expect(tools.length).toBeGreaterThan(0);
    const names = tools.map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Write");
    expect(names).toContain("Edit");
    expect(names).toContain("Bash");
    expect(names).toContain("Grep");
    expect(names).toContain("SubAgent");
  });

  it("subAgentTools() returns only read-only non-interactive tools", () => {
    const safe = subAgentTools();
    const names = safe.map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Grep");
    expect(names).toContain("ActivateSkill");
    expect(names).not.toContain("Bash");
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("AskUser");
    expect(names).not.toContain("SubAgent");
  });

  it("ToolRegistry can register and retrieve tools", () => {
    const registry = new ToolRegistry();
    const tools = all();
    for (const tool of tools) {
      registry.register(tool);
    }
    expect(registry.get("Read")).toBeDefined();
    expect(registry.get("Bash")).toBeDefined();
    expect(registry.get("NonExistent")).toBeUndefined();
  });

  it("ToolRegistry filters by requirement", () => {
    const registry = new ToolRegistry();
    const noAgent = {};
    for (const tool of all()) {
      if (tool.requires?.some((r) => !noAgent[r])) continue;
      registry.register(tool);
    }
    expect(registry.get("Read")).toBeDefined();
    expect(registry.get("SubAgent")).toBeUndefined();
  });
});
