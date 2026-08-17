import type { CommandHandler } from "../registry.js";

export const compressCommand: CommandHandler = {
  name: "compress",
  description: "Compress conversation context",
  handler: async (_args, ctx): Promise<void> => {
    await ctx.contextManager.compress();
    ctx.sessionManager.reportStatus({
      role: "status",
      content: "(Compression complete)",
    });
  },
};
