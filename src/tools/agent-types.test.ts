import { describe, it, expect } from "vitest";
import {
  createDefaultAgentTypes,
  AgentTypeRegistry,
  DEFAULT_AGENT_TYPE,
} from "./agent-types.js";

describe("agent-types registry", () => {
  it("registers and retrieves a type", () => {
    const registry = new AgentTypeRegistry();
    registry.register({
      name: "test-only-type",
      description: "d",
      systemPrompt: "p",
      tools: "readonly",
    });
    expect(registry.get("test-only-type")?.systemPrompt).toBe("p");
  });

  it("returns undefined for unknown type", () => {
    expect(
      createDefaultAgentTypes().get("nope-does-not-exist"),
    ).toBeUndefined();
  });

  it("listAgentTypes includes the built-ins", () => {
    const names = createDefaultAgentTypes()
      .list()
      .map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["researcher", "reviewer", "planner", "worker"]),
    );
  });

  it("default type is researcher", () => {
    expect(DEFAULT_AGENT_TYPE).toBe("researcher");
    expect(createDefaultAgentTypes().get(DEFAULT_AGENT_TYPE)).toBeDefined();
  });

  it("read-only types use readonly tools, worker uses all", () => {
    const registry = createDefaultAgentTypes();
    expect(registry.get("researcher")?.tools).toBe("readonly");
    expect(registry.get("reviewer")?.tools).toBe("readonly");
    expect(registry.get("planner")?.tools).toBe("readonly");
    expect(registry.get("worker")?.tools).toBe("all");
  });

  it("fresh instances do not share registrations", () => {
    const a = new AgentTypeRegistry();
    const b = new AgentTypeRegistry();
    b.register({
      name: "only-in-b",
      description: "d",
      systemPrompt: "p",
      tools: "readonly",
    });
    expect(a.get("only-in-b")).toBeUndefined();
    expect(b.get("only-in-b")).toBeDefined();
  });
});
