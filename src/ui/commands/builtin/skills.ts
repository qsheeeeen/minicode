import type { CommandHandler } from "../registry.js";

export const skillsCommand: CommandHandler = {
  name: "skills",
  description: "List available skills",
  handler: async (_args, ctx): Promise<void> => {
    const skills = ctx.skills.getAvailable();
    const content =
      skills.length === 0
        ? "(No skills available)"
        : [
            "Available skills:",
            ...skills.map((s) => `  /${s.name} - ${s.description}`),
          ].join("\n");
    ctx.sessionManager.reportStatus({
      role: "status",
      content,
    });
  },
};
