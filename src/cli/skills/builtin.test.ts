import { describe, it, expect } from 'vitest';
import { skillRegistry } from './index.js';
import './builtin.js';

describe('builtin skills', () => {
  it('registers skill-creator into registry', () => {
    const skills = skillRegistry.getAvailableSkills();
    const creator = skills.find(s => s.name === 'skill-creator');
    expect(creator).toBeDefined();
    expect(creator!.description).toContain('Guide for creating effective skills');
  });

  it('skill-creator has a body', () => {
    const body = skillRegistry.getSkillBody('skill-creator');
    expect(body).toBeDefined();
    expect(body!.length).toBeGreaterThan(0);
  });
});
