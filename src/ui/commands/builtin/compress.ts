import { registerCommand } from "../registry.js";

registerCommand({
  name: "compress",
  description: "Compress conversation context",
  handler: async (_args, ctx): Promise<void> => {
    await ctx.agent.compress();
    ctx.sessionManager.reportStatus({
      role: "status",
      content: "(Compression complete)",
      timestamp: new Date(),
    });
  },
});
