import type { SkillRegistry } from "../../skills/index.js";
import type { CommandRegistry } from "./registry.js";

/**
 * Register every loaded skill as a prompt-type slash command.
 *
 * Lives in the UI layer (commands are a UI concept) and takes registries by
 * injection; the core skills layer never imports UI. Builtin commands are
 * registered first, so they win name collisions.
 */
export function registerSkillCommands(
  commands: CommandRegistry,
  skills: SkillRegistry,
): void {
  for (const skill of skills.getAvailable()) {
    if (commands.get(skill.name)) {
      console.warn(
        `Skill "${skill.name}" skipped: a builtin command with the same name already exists.`,
      );
      continue;
    }
    const body = skills.getBody(skill.name);
    if (!body) continue;

    commands.register({
      name: skill.name,
      description: skill.description,
      prompt: (args: string[]) => {
        const userInput = args.length > 0 ? `\n\n${args.join(" ")}` : "";
        return `<activated_skill name="${skill.name}">\n<instructions>\n${body}\n</instructions>\n</activated_skill>${userInput}`;
      },
    });
  }
}
