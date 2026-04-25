import fs from 'fs/promises';
import path from 'path';

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
  dirPath: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillMeta>();

  /**
   * Parse a SKILL.md file to extract YAML frontmatter (name, description) and body.
   */
  public parseSkillFile(content: string, dirPath: string): SkillMeta | null {
    // Regex to match YAML frontmatter enclosed in ---
    // ^---\n([\s\S]+?)\n---\n([\s\S]*)
    const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2];

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch || !descMatch) return null;

    // Remove quotes if present
    const name = nameMatch[1].replace(/^["'](.*)["']$/, '$1').trim();
    const description = descMatch[1].replace(/^["'](.*)["']$/, '$1').trim();

    return {
      name,
      description,
      body: body.trim(),
      dirPath
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
