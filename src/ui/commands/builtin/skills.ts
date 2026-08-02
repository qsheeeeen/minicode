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

    const { createElement: el } = await import("react");
    const { Box, Text } = await import("ink");

    const skillElements = skills.map((skill) =>
      el(
        Box,
        { key: skill.name, flexDirection: "row" },
        el(Box, { width: 25 }, el(Text, { color: "cyan" }, `  /${skill.name}`)),
        el(
          Box,
          { flexGrow: 1, flexShrink: 1 },
          el(
            Text,
            { wrap: "truncate", dimColor: true },
            `- ${skill.description}`,
          ),
        ),
      ),
    );

    const element = el(
      Box,
      { flexDirection: "column", paddingY: 1 },
      el(Text, { bold: true }, "Available skills:"),
      ...skillElements,
    );

    const lines = ["Available skills:"];
    for (const skill of skills) {
      lines.push(`  /${skill.name} - ${skill.description}`);
    }

    ctx.sessionManager.reportStatus({
      role: "status",
      content: lines.join("\n"),
      element,
      timestamp: new Date(),
    });
  },
};
