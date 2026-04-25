import { describe, it, expect } from 'vitest';
import { SkillRegistry } from './skill-registry.js';

describe('SkillRegistry', () => {
  describe('parseSkillFile', () => {
    it('parses valid SKILL.md with frontmatter', () => {
      const content = `---
name: my-skill
description: This is a test skill.
---
# Skill Body
Some text here.`;
      
      const registry = new SkillRegistry();
      const result = registry.parseSkillFile(content, '/path');
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-skill');
      expect(result?.description).toBe('This is a test skill.');
      expect(result?.body).toBe('# Skill Body\nSome text here.');
      expect(result?.dirPath).toBe('/path');
    });

    it('returns null if missing frontmatter', () => {
      const content = `# Skill Body\nSome text here.`;
      const registry = new SkillRegistry();
      const result = registry.parseSkillFile(content, '/path');
      expect(result).toBeNull();
    });

    it('handles quotes in frontmatter values', () => {
      const content = `---
name: "quoted-skill"
description: 'Quoted description'
---
# Body`;
      
      const registry = new SkillRegistry();
      const result = registry.parseSkillFile(content, '/path');
      
      expect(result?.name).toBe('quoted-skill');
      expect(result?.description).toBe('Quoted description');
    });
  });
});
