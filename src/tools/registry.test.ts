import { describe, it, expect } from "vitest";
import {
  ToolRegistry,
  capability,
  createCapabilities,
  lazy,
} from "./registry.js";
import type { ToolDef } from "./index.js";

function makeTool(name: string): ToolDef {
  return {
    name,
    description: "A test tool",
    input_schema: { type: "object", properties: {} },
    execute: async () => ({ outcome: "success", result: "ok" }),
  };
}

describe("ToolRegistry.register", () => {
  it("adds tool to registry", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("reg-test");
    registry.register(tool);
    expect(registry.getAll().get("reg-test")).toBe(tool);
  });

  it("overwrites existing tool with same name", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("overwrite-test"));
    registry.register({ ...makeTool("overwrite-test"), description: "Tool 2" });
    expect(registry.getAll().get("overwrite-test")?.description).toBe("Tool 2");
  });

  it("instances are isolated from each other", () => {
    const a = new ToolRegistry();
    const b = new ToolRegistry();
    a.register(makeTool("only-a"));
    expect(a.get("only-a")).toBeDefined();
    expect(b.get("only-a")).toBeUndefined();
  });

  it("reset clears the registry", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("temp"));
    registry.reset();
    expect(registry.getAll().size).toBe(0);
  });
});

describe("ToolRegistry.getAll", () => {
  it("returns all registered tools as Map", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("one"));
    registry.register(makeTool("two"));
    expect(registry.getAll()).toBeInstanceOf(Map);
    expect(registry.getAll().size).toBe(2);
  });

  it("returns a copy (mutations don't affect source)", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("Read"));
    const tools = registry.getAll();
    tools.delete("Read");
    expect(registry.get("Read")).toBeDefined();
  });
});

describe("getSubAgentTools", () => {
  const readOnlyTool = (name: string): ToolDef => ({
    ...makeTool(name),
    readOnly: true,
  });
  const writeTool = (name: string): ToolDef => ({
    ...makeTool(name),
    requiresPermission: true,
  });
  const interactiveTool = (name: string): ToolDef => ({
    ...makeTool(name),
    interactive: true,
  });

  function registryWithSample(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(readOnlyTool("Read"));
    registry.register(readOnlyTool("Grep"));
    registry.register(writeTool("Write"));
    registry.register(interactiveTool("AskUser"));
    registry.register(writeTool("SubAgent"));
    return registry;
  }

  it("returns only read-only non-interactive tools by default", () => {
    const safe = registryWithSample().getSubAgentTools();
    expect([...safe.keys()].sort()).toEqual(["Grep", "Read"]);
  });

  it("readOnly:false includes write tools (superset of default)", () => {
    const safe = registryWithSample().getSubAgentTools();
    const all = registryWithSample().getSubAgentTools({ readOnly: false });
    for (const name of safe.keys()) expect(all.has(name)).toBe(true);
    // still excludes SubAgent and interactive tools
    expect(all.has("SubAgent")).toBe(false);
    expect(all.has("AskUser")).toBe(false);
    expect(all.has("Write")).toBe(true);
  });

  it("allowlist takes precedence and returns only named tools", () => {
    const allowed = registryWithSample().getSubAgentTools({
      allowlist: ["Read", "Grep"],
    });
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

  it("require returns the service and throws when missing", () => {
    const Foo = capability<string>("foo");
    const caps = createCapabilities([[Foo, "bar"]]);
    expect(caps.require(Foo)).toBe("bar");
    expect(() => createCapabilities([]).require(Foo)).toThrow(
      'Required capability not provided: "foo"',
    );
  });

  it("lazy capabilities resolve at read time", () => {
    const Foo = capability<{ v: number }>("foo-lazy");
    let current = { v: 1 };
    const caps = createCapabilities([[Foo, lazy(() => current)]]);
    expect(caps.require(Foo)).toEqual({ v: 1 });
    current = { v: 2 };
    expect(caps.require(Foo)).toEqual({ v: 2 });
  });

  it("function capabilities are not treated as lazy factories", () => {
    const Fn = capability<() => string>("foo-fn");
    const fn = () => "value";
    const caps = createCapabilities([[Fn, fn]]);
    expect(caps.require(Fn)).toBe(fn);
  });

  it("rejects duplicate capability keys at construction", () => {
    const Foo = capability<string>("foo");
    expect(() =>
      createCapabilities([
        [Foo, "x"],
        [Foo, "y"],
      ]),
    ).toThrow('Duplicate capability registration: "foo"');
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
