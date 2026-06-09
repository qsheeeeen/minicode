import { describe, it, expect, vi } from "vitest";

vi.mock("../skills/index.js", () => ({
  getSkillBody: vi.fn(),
}));

import { loadSkillTool } from "./load-skill.js";
import { getSkillBody } from "../skills/index.js";

const mockGetSkillBody = vi.mocked(getSkillBody);

describe("loadSkillTool", () => {
  it("returns loaded skill body wrapped in tags", async () => {
    mockGetSkillBody.mockReturnValue("do the thing");

    const result = await loadSkillTool.execute({ name: "my-skill" });
    expect(result.output).toBe(
      '<loaded_skill name="my-skill">\n<instructions>\ndo the thing\n</instructions>\n</loaded_skill>',
    );
  });

  it("returns error when skill not found", async () => {
    mockGetSkillBody.mockReturnValue(undefined);

    const result = await loadSkillTool.execute({ name: "nonexistent" });
    expect(result.output).toBe("Error: Skill 'nonexistent' not found.");
  });
});
