import type { ToolDef, ToolResult, ToolExecutionContext } from "./index.js";

export const activateSkillTool: ToolDef = {
  name: "ActivateSkill",
  description:
    "Loads the full instructions of a skill by name. Returns the skill's instructions wrapped in <activated_skill> tags. Use this when you identify a task that matches a skill's description.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to activate.",
      },
    },
    required: ["name"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const skillName = String(args.name);
    const skillBody = context?.skillRegistry?.getSkillBody(skillName);

    if (!skillBody) {
      return { output: `Error: Skill '${skillName}' not found.` };
    }

    const output = `<activated_skill name="${skillName}">\n<instructions>\n${skillBody}\n</instructions>\n</activated_skill>`;
    return { output };
  },
};
