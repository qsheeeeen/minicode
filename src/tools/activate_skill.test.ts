import { describe, it, expect, vi } from "vitest";

vi.mock("../skills/index.js", () => ({
  getSkillBody: vi.fn(),
}));

import { activateSkillTool } from "./activate_skill.js";
import { getSkillBody } from "../skills/index.js";

const mockGetSkillBody = vi.mocked(getSkillBody);

describe("activateSkillTool", () => {
  it("returns activated skill body wrapped in tags", async () => {
    mockGetSkillBody.mockReturnValue("do the thing");

    const result = await activateSkillTool.execute({ name: "my-skill" });
    expect(result.output).toBe(
      '<activated_skill name="my-skill">\n<instructions>\ndo the thing\n</instructions>\n</activated_skill>',
    );
  });

  it("returns error when skill not found", async () => {
    mockGetSkillBody.mockReturnValue(undefined);

    const result = await activateSkillTool.execute({ name: "nonexistent" });
    expect(result.output).toBe("Error: Skill 'nonexistent' not found.");
  });
});
