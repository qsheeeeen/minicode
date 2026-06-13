import { registerCommand } from "../registry.js";
import type { EffortLevel } from "../../../llm/client.js";

registerCommand({
  name: "effort",
  description: "Set thinking effort (low|medium|high|xhigh|max)",
  handler: async (args, ctx): Promise<void> => {
    const value = args[0]?.toLowerCase();
    const valid = ["low", "medium", "high", "xhigh", "max"] as const;
    if (!value || !(valid as readonly string[]).includes(value)) {
      // Show effort selection UI
      ctx.setInputMode("effort-select");
      return;
    }
    ctx.model.setEffort(value as EffortLevel);
    await ctx.config.setEffort(value as EffortLevel);
    ctx.sessionManager.reportStatus({
      role: "status",
      content: `(Effort set to: ${value})`,
      timestamp: new Date(),
    });
  },
});
