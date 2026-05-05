import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { skillRegistry, SkillRegistry } from './index.js';

async function createTempSkillDir(
  skillDirName: string,
  skillMdContent: string,
): Promise<string> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
  const skillDir = path.join(baseDir, skillDirName);
  await fs.mkdir(skillDir);
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');
  return baseDir;
}

describe('builtin skills', () => {
  it('registers exactly 2 builtin skills', () => {
    const skills = skillRegistry.getAvailableSkills();
    expect(skills).toHaveLength(2);
  });

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

  it('registers init skill with promptFile in description', () => {
    const skills = skillRegistry.getAvailableSkills();
    const init = skills.find(s => s.name === 'init');
    expect(init).toBeDefined();
    expect(init!.description).toContain('MINICODE.md');
    expect(init!.description).toContain('onboarding flow');
  });

  it('init skill has a body', () => {
    const body = skillRegistry.getSkillBody('init');
    expect(body).toBeDefined();
    expect(body!.length).toBeGreaterThan(0);
  });

  it('getSkillBody returns undefined for unknown skill', () => {
    const body = skillRegistry.getSkillBody('nonexistent');
    expect(body).toBeUndefined();
  });
});

describe('SkillRegistry', () => {
  describe('loadSkills', () => {
    it('loads valid SKILL.md with frontmatter', async () => {
      const content = [
        '---',
        'name: my-skill',
        'description: This is a test skill.',
        '---',
        '# Skill Body',
        'Some text here.',
      ].join('\n');

      const baseDir = await createTempSkillDir('my-skill', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        const skills = registry.getAvailableSkills();
        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('my-skill');
        expect(skills[0].description).toBe('This is a test skill.');
        expect(registry.getSkillBody('my-skill')).toBe('# Skill Body\nSome text here.');
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('loads multiple skills from the same directory', async () => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      try {
        const dirA = path.join(baseDir, 'skill-a');
        const dirB = path.join(baseDir, 'skill-b');
        await fs.mkdir(dirA);
        await fs.mkdir(dirB);
        await fs.writeFile(path.join(dirA, 'SKILL.md'), '---\nname: skill-a\ndescription: First skill\n---\n\nBody A');
        await fs.writeFile(path.join(dirB, 'SKILL.md'), '---\nname: skill-b\ndescription: Second skill\n---\n\nBody B');

        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        const skills = registry.getAvailableSkills();
        expect(skills).toHaveLength(2);
        expect(skills.map(s => s.name).sort()).toEqual(['skill-a', 'skill-b']);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('ignores non-directory entries', async () => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      try {
        await fs.writeFile(path.join(baseDir, 'readme.md'), 'not a skill dir');

        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);
        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('handles missing skills directory gracefully', async () => {
      const registry = new SkillRegistry();
      await registry.loadSkills('/nonexistent/skills/dir');
      expect(registry.getAvailableSkills()).toHaveLength(0);
    });

    it('ignores empty directories', async () => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      try {
        const emptyDir = path.join(baseDir, 'empty-dir');
        await fs.mkdir(emptyDir);

        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('ignores SKILL.md without frontmatter', async () => {
      const content = ['# Skill Body', 'Some text here.'].join('\n');

      const baseDir = await createTempSkillDir('no-frontmatter', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('skips SKILL.md with invalid YAML frontmatter', async () => {
      const content = [
        '---',
        'name: "unclosed',
        'description: Broken YAML',
        '---',
        'Body text',
      ].join('\n');

      const baseDir = await createTempSkillDir('bad-yaml', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);
        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('parses YAML frontmatter with quotes correctly', async () => {
      const content = [
        '---',
        'name: "quoted-skill"',
        "description: 'Quoted description'",
        '---',
        '# Body',
      ].join('\n');

      const baseDir = await createTempSkillDir('quoted', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        const skills = registry.getAvailableSkills();
        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('quoted-skill');
        expect(skills[0].description).toBe('Quoted description');
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('handles YAML folded block scalar for description', async () => {
      const content = [
        '---',
        'name: block-skill',
        'description: >',
        '  A multi-line description',
        '  wrapped with YAML folded block scalar.',
        '---',
        '# Body',
      ].join('\n');

      const baseDir = await createTempSkillDir('block', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        const skills = registry.getAvailableSkills();
        expect(skills).toHaveLength(1);
        expect(skills[0].description).toContain('A multi-line description');
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('ignores skills missing required name field', async () => {
      const content = [
        '---',
        'description: Only description here.',
        '---',
        '# Body',
      ].join('\n');

      const baseDir = await createTempSkillDir('no-name', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('ignores skills missing required description field', async () => {
      const content = [
        '---',
        'name: no-desc',
        '---',
        '# Body',
      ].join('\n');

      const baseDir = await createTempSkillDir('no-desc', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('ignores non-object YAML frontmatter (array)', async () => {
      const content = [
        '---',
        '- item1',
        '- item2',
        '---',
        '# Body',
      ].join('\n');

      const baseDir = await createTempSkillDir('array', content);
      try {
        const registry = new SkillRegistry();
        await registry.loadSkills(baseDir);

        expect(registry.getAvailableSkills()).toHaveLength(0);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
