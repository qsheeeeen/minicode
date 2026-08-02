import { describe, it, expect, vi } from "vitest";

import { loadSkillTool } from "./load-skill.js";
import { SkillRegistryCapability } from "../capabilities.js";
import { createCapabilities } from "../registry.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";

function makeContext(getBody: ReturnType<typeof vi.fn>) {
  return {
    capabilities: createCapabilities([[SkillRegistryCapability, { getBody }]]),
  } as any;
}

describe("loadSkillTool", () => {
  it("returns loaded skill body wrapped in tags", async () => {
    const getBody = vi.fn().mockReturnValue("do the thing");

    const result = await loadSkillTool.execute(
      { name: "my-skill" },
      makeContext(getBody),
    );
    expect(getBody).toHaveBeenCalledWith("my-skill");
    expect(unwrapSuccess(result)).toBe(
      '<loaded_skill name="my-skill">\n<instructions>\ndo the thing\n</instructions>\n</loaded_skill>',
    );
  });

  it("returns error when skill not found", async () => {
    const getBody = vi.fn().mockReturnValue(undefined);

    const result = await loadSkillTool.execute(
      { name: "nonexistent" },
      makeContext(getBody),
    );
    expect(result.outcome).toBe("error");
    expect(unwrapError(result)).toBe("Skill 'nonexistent' not found");
  });

  it("returns error when no skill registry is available", async () => {
    const result = await loadSkillTool.execute({ name: "x" });
    expect(result.outcome).toBe("error");
  });
});
