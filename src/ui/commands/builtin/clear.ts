import { registerCommand } from "../registry.js";
registerCommand({
  name: "clear",
  description: "Clear all context and start a new session",
  handler: async (_args, ctx): Promise<void> => {
    ctx.sessionManager.clearSession();
    ctx.contextManager.reset();
    const newSession = `session-${Date.now()}`;
    await ctx.switchSession(newSession, { statusMessage: "(Cleared)" });
  },
});
