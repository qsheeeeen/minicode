import { registerCommand } from "../registry.js";
registerCommand({
  name: "new",
  description: "Create a new session",
  handler: async (args, ctx): Promise<void> => {
    const name = args.join(" ");
    if (name) {
      ctx.sessionManager.clearSession();
      ctx.contextManager.reset();
      await ctx.switchSession(name, {
        statusMessage: `Created session: ${name}`,
      });
    }
  },
});
