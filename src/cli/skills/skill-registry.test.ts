import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SkillRegistry } from './skill-registry.js';

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
  });
});
