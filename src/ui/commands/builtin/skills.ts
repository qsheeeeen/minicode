import type { CommandHandler } from "../registry.js";

export const skillsCommand: CommandHandler = {
  name: "skills",
  description: "List available skills",
  handler: async (_args, ctx): Promise<void> => {
    const skills = ctx.skills.getAvailable();
    if (skills.length === 0) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(No skills available)",
        timestamp: new Date(),
      });
      return;
    }

    // Data only — how a status renders is the renderer's business, and a
    // React element would be dead weight in the service-layer event bus.
    const lines = ["Available skills:"];
    for (const skill of skills) {
      lines.push(`  /${skill.name} - ${skill.description}`);
    }
    ctx.sessionManager.reportStatus({
      role: "status",
      content: lines.join("\n"),
      timestamp: new Date(),
    });
  },
};
