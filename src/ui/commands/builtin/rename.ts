import type { CommandHandler } from "../registry.js";

export const renameCommand: CommandHandler = {
  name: "rename",
  description: "Rename current session",
  handler: async (args, ctx): Promise<void> => {
    const newName = args.join(" ");
    if (newName) {
      await ctx.renameCurrentSession(newName);
    }
  },
};
