import { describe, it, expect } from "vitest";
import { agentTool } from "./sub-agent.js";

describe("agentTool", () => {
  describe("execute", () => {
    it("returns error when registry not available", async () => {
      const result = await agentTool.execute({ task: "test" }, {});
      expect(result.output).toContain("AgentRegistry not available");
    });

    it("returns error when config not available", async () => {
      const result = await agentTool.execute(
        { task: "test" },
        { registry: { allocateSubId: () => "2" } as any },
      );
      expect(result.output).toContain("Agent config not available");
    });
  });
});
