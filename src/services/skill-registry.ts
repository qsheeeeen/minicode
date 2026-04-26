import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
  dirPath?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillMeta>();

  public register(meta: SkillMeta): void {
    this.skills.set(meta.name, meta);
  }

  /**
   * Parse a SKILL.md file to extract YAML frontmatter (name, description) and body.
   */
  private parseSkillFile(content: string, dirPath: string): SkillMeta | null {
    const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)/);
    if (!match) return null;

    let frontmatter: unknown;
    try {
      frontmatter = parseYaml(match[1]);
    } catch {
      return null;
    }

    if (typeof frontmatter !== 'object' || frontmatter === null) return null;

    const fm = frontmatter as Record<string, unknown>;
    const name = typeof fm.name === 'string' ? fm.name.trim() : undefined;
    const description = typeof fm.description === 'string' ? fm.description.trim() : undefined;

    if (!name || !description) return null;

    return {
      name,
      description,
      body: match[2].trim(),
      dirPath,
    };
  }

  /**
   * Load all skills from a given directory.
   * Expects subdirectories containing SKILL.md files.
   */
  public async loadSkills(skillsDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDirPath = path.join(skillsDir, entry.name);
          const skillFilePath = path.join(skillDirPath, 'SKILL.md');
          
          try {
            const content = await fs.readFile(skillFilePath, 'utf-8');
            const meta = this.parseSkillFile(content, skillDirPath);
            if (meta) {
              this.skills.set(meta.name, meta);
            }
          } catch (e) {
            // Ignore if SKILL.md is missing or unreadable
          }
        }
      }
    } catch (e) {
      // Ignore if skills directory doesn't exist
    }
  }

  public getAvailableSkills(): Pick<SkillMeta, 'name' | 'description'>[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description
    }));
  }

  public getSkillBody(name: string): string | undefined {
    return this.skills.get(name)?.body;
  }
}
