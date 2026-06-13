import { registerCommand } from "../registry.js";

registerCommand({
  name: "exit",
  description: "Exit the application",
  handler: async (_args, ctx): Promise<void> => {
    ctx.exit();
  },
});
