import { newSessionName } from "../../../services/session-manager.js";
import type { CommandHandler } from "../registry.js";

export const clearCommand: CommandHandler = {
  name: "clear",
  description: "Clear all context and start a new session",
  handler: async (_args, ctx): Promise<void> => {
    ctx.sessionManager.clearSession();
    ctx.contextManager.reset();
    await ctx.switchSession(newSessionName(), { statusMessage: "(Cleared)" });
  },
};
