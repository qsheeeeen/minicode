import type { ToolDef, ToolResult, ToolExecutionContext } from './index.js';
import React from 'react';
import { Text } from 'ink';

export const activateSkillTool: ToolDef = {
  name: 'activate_skill',
  description: "Activates a specialized agent skill by name. Returns the skill's instructions wrapped in <activated_skill> tags. Use this when you identify a task that matches a skill's description.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name of the skill to activate.' }
    },
    required: ['name']
  },
  execute: async (args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> => {
    const skillName = String(args.name);
    const skillBody = context?.skillRegistry?.getSkillBody(skillName);
    
    if (!skillBody) {
      const msg = `Error: Skill '${skillName}' not found.`;
      return { 
        output: msg, 
        display: React.createElement(Text, { color: 'red' }, msg) 
      };
    }

    const output = `<activated_skill name="${skillName}">\n<instructions>\n${skillBody}\n</instructions>\n</activated_skill>`;
    return {
      output,
      display: React.createElement(Text, { color: 'green' }, `Activated skill: ${skillName}`)
    };
  }
};
