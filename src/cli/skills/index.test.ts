import { describe, it, expect, vi, beforeEach } from 'vitest';
import { skillRegistry, SkillRegistry } from './index.js';
import fs from 'fs/promises';

vi.mock('fs/promises');

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

describe('SkillRegistry loadSkills', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    vi.clearAllMocks();
  });

  it('loads valid SKILL.md files from a directory', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'my-skill', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue(`---
name: my-skill
description: Does something useful
---

# My Skill
Do the thing.
`);

    await registry.loadSkills('/skills');

    const available = registry.getAvailableSkills();
    expect(available).toHaveLength(1);
    expect(available[0]).toEqual({ name: 'my-skill', description: 'Does something useful' });
    expect(registry.getSkillBody('my-skill')).toBe('# My Skill\nDo the thing.');
  });

  it('does not load non-directory entries', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'readme.md', isDirectory: () => false, isFile: () => true, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('handles missing skills directory gracefully', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

    await expect(registry.loadSkills('/nonexistent')).resolves.toBeUndefined();
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('handles missing SKILL.md inside a skill directory gracefully', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'broken-skill', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('skips SKILL.md with invalid YAML frontmatter', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'bad-yaml', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue(`---
name: "unclosed
description: Broken YAML
---

Body text
`);

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('skips SKILL.md without frontmatter', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'no-frontmatter', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue('# Just a heading\nNo frontmatter here.');

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('skips SKILL.md with missing name in frontmatter', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'no-name', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue(`---
description: Forgot the name field
---

Body
`);

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('skips SKILL.md with missing description in frontmatter', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'no-desc', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue(`---
name: no-desc
---

Body
`);

    await registry.loadSkills('/skills');
    expect(registry.getAvailableSkills()).toHaveLength(0);
  });

  it('loads multiple skills from the same directory', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'skill-a', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
      { name: 'skill-b', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSocket: () => false, isFIFO: () => false, isSymbolicLink: () => false, parentPath: '', path: '' },
    ] as any);
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(`---
name: skill-a
description: First skill
---

Body A
`)
      .mockResolvedValueOnce(`---
name: skill-b
description: Second skill
---

Body B
`);

    await registry.loadSkills('/skills');

    const available = registry.getAvailableSkills();
    expect(available).toHaveLength(2);
    expect(available.map(s => s.name).sort()).toEqual(['skill-a', 'skill-b']);
  });
});
