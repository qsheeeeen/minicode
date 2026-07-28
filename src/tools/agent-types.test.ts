import { describe, it, expect } from "vitest";
import {
  registerAgentType,
  getAgentType,
  listAgentTypes,
  DEFAULT_AGENT_TYPE,
} from "./agent-types.js";

describe("agent-types registry", () => {
  it("registers and retrieves a type", () => {
    registerAgentType({
      name: "test-only-type",
      description: "d",
      systemPrompt: "p",
      tools: "readonly",
    });
    expect(getAgentType("test-only-type")?.systemPrompt).toBe("p");
  });

  it("returns undefined for unknown type", () => {
    expect(getAgentType("nope-does-not-exist")).toBeUndefined();
  });

  it("listAgentTypes includes the built-ins", () => {
    const names = listAgentTypes().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "researcher",
        "reviewer",
        "planner",
        "worker",
      ]),
    );
  });

  it("default type is researcher", () => {
    expect(DEFAULT_AGENT_TYPE).toBe("researcher");
    expect(getAgentType(DEFAULT_AGENT_TYPE)).toBeDefined();
  });

  it("read-only types use readonly tools, worker uses all", () => {
    expect(getAgentType("researcher")?.tools).toBe("readonly");
    expect(getAgentType("reviewer")?.tools).toBe("readonly");
    expect(getAgentType("planner")?.tools).toBe("readonly");
    expect(getAgentType("worker")?.tools).toBe("all");
  });
});
