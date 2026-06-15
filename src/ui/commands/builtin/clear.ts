import { registerCommand } from "../registry.js";
import { switchSession } from "../../../services/session-lifecycle.js";

registerCommand({
  name: "clear",
  description: "Clear all context and start a new session",
  handler: async (_args, ctx): Promise<void> => {
    ctx.sessionManager.clearSession();
    ctx.contextManager.reset();
    const newSession = `session-${Date.now()}`;
    await switchSession({
      sessionManager: ctx.sessionManager,
      sessionName: newSession,
      setCurrentSession: ctx.setCurrentSession,
      setLogger: ctx.setLogger,
      sessionStats: ctx.sessionStats,
      statusMessage: "(Cleared)",
    });
  },
});
