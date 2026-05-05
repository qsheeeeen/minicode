import { describe, it, expect } from 'vitest';
import { activateSkillTool } from './activate_skill.js';
import type { SkillRegistry } from '../cli/skills/index.js';

describe('activateSkillTool', () => {
  it('returns activated skill body wrapped in tags', async () => {
    const context = {
      skillRegistry: {
        getSkillBody: (name: string) => (name === 'my-skill' ? 'do the thing' : undefined),
      } as SkillRegistry,
    };

    const result = await activateSkillTool.execute({ name: 'my-skill' }, context);
    expect(result.output).toBe(
      '<activated_skill name="my-skill">\n<instructions>\ndo the thing\n</instructions>\n</activated_skill>'
    );
  });

  it('returns error when skill not found', async () => {
    const context = {
      skillRegistry: {
        getSkillBody: () => undefined,
      } as SkillRegistry,
    };

    const result = await activateSkillTool.execute({ name: 'nonexistent' }, context);
    expect(result.output).toBe("Error: Skill 'nonexistent' not found.");
  });

  it('returns error when no skillRegistry in context', async () => {
    const result = await activateSkillTool.execute({ name: 'any' }, undefined);
    expect(result.output).toBe("Error: Skill 'any' not found.");
  });
});
