import { describe, it, expect, vi } from "vitest";
import { agentTool } from "./sub-agent.js";
import {
  createCapabilities,
  type ToolExecutionContext,
  type SubAgentSpawner,
} from "../registry.js";
import { SubAgentSpawnerCapability } from "../capabilities.js";
import { unwrapError } from "../../testing/index.js";

function makeCtx(spawnSubAgent?: SubAgentSpawner): ToolExecutionContext {
  return {
    config: {} as ToolExecutionContext["config"],
    currentAgentId: "1",
    signal: undefined,
    capabilities: createCapabilities(
      spawnSubAgent ? [[SubAgentSpawnerCapability, spawnSubAgent]] : [],
    ),
  };
}

describe("agentTool", () => {
  it("returns error when spawnSubAgent is not configured", async () => {
    const result = await agentTool.execute({ task: "test" }, makeCtx());
    expect(result.outcome).toBe("error");
    expect(unwrapError(result)).toContain("not configured");
  });

  it("delegates to spawnSubAgent with task + default agentType (researcher)", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      outcome: "success",
      result: "child reply",
    }));
    const ctx = makeCtx(spawnSubAgent);

    const result = await agentTool.execute({ task: "explore" }, ctx);

    expect(spawnSubAgent).toHaveBeenCalledWith({
      task: "explore",
      agentType: "researcher",
      parent: ctx,
    });
    expect(result).toEqual({ outcome: "success", result: "child reply" });
  });

  it("passes through an explicit agentType", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      outcome: "success",
      result: "ok",
    }));
    const ctx = makeCtx(spawnSubAgent);

    await agentTool.execute({ task: "do work", agentType: "worker" }, ctx);

    expect(spawnSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: "worker" }),
    );
  });
});
