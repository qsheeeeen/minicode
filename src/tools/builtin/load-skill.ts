import type { ToolDef, ToolRunResult, ToolExecutionContext } from "../registry.js";
import { register } from "../registry.js";
import { getSkillBody } from "../../skills/index.js";

export const loadSkillTool: ToolDef = {
  name: "LoadSkill",
  description:
    "Loads the full instructions of a skill by name. Returns the skill's instructions wrapped in <loaded_skill> tags. Use this when you identify a task that matches a skill's description.",
  readOnly: true,
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to load.",
      },
    },
    required: ["name"],
  },
  execute: async (
    args: Record<string, unknown>,
    _context?: ToolExecutionContext,
  ): Promise<ToolRunResult> => {
    const skillName = String(args.name);
    const skillBody = getSkillBody(skillName);

    if (!skillBody) {
      return { outcome: "error", reason: `Skill '${skillName}' not found` };
    }

    const output = `<loaded_skill name="${skillName}">\n<instructions>\n${skillBody}\n</instructions>\n</loaded_skill>`;
    return { outcome: "success", result: output };
  },
};
register(loadSkillTool);
