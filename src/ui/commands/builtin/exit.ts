import type { CommandHandler } from "../registry.js";

export const exitCommand: CommandHandler = {
  name: "exit",
  description: "Exit the application",
  handler: async (_args, ctx): Promise<void> => {
    ctx.exit();
  },
};
