import {
  loadSkills,
  getAvailableSkills,
  getSkillBody,
} from "./index.js";
import {
  registerCommand,
  getCommandNames,
} from "../ui/commands/index.js";

/**
 * SkillManager — owns the skill loading lifecycle and exposes skills
 * as slash commands. Encapsulates directory scanning + command wiring
 * so the CLI entry point stays free of these details.
 *
 * The underlying global registry (skills/index.ts) remains accessible
 * to other consumers (LoadSkill tool, prompts, command help) — this
 * class only manages the load-and-register flow.
 */
export class SkillManager {
  private dirs: string[] = [];

  /** Add a directory to scan for skills (each subdir with SKILL.md). */
  addDirectory(dir: string): this {
    this.dirs.push(dir);
    return this;
  }

  /** Load skills from all added directories into the global registry. */
  async loadAll(): Promise<void> {
    for (const dir of this.dirs) {
      await loadSkills(dir);
    }
  }

  /** Register every loaded skill as a prompt-type slash command. */
  registerAsCommands(): void {
    for (const skill of getAvailableSkills()) {
      if (getCommandNames().includes(skill.name)) {
        console.warn(
          `Skill "${skill.name}" skipped: a builtin command with the same name already exists.`,
        );
        continue;
      }
      const body = getSkillBody(skill.name);
      if (!body) continue;

      registerCommand({
        name: skill.name,
        description: skill.description,
        prompt: (args: string[]) => {
          const userInput = args.length > 0 ? `\n\n${args.join(" ")}` : "";
          return `<activated_skill name="${skill.name}">\n<instructions>\n${body}\n</instructions>\n</activated_skill>${userInput}`;
        },
      });
    }
  }
}
