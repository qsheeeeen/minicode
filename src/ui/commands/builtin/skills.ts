import type { CommandHandler } from "../registry.js";

export const skillsCommand: CommandHandler = {
  name: "skills",
  description: "List available skills",
  handler: async (_args, ctx): Promise<void> => {
    const skills = ctx.skills.getAvailable();
    // Data only — how a status renders is the renderer's business, and a
    // React element would be dead weight in the service-layer event bus.
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
      timestamp: new Date(),
    });
  },
};
