import { registerCommand } from "../registry.js";
import { switchSession } from "../../../services/session-lifecycle.js";

registerCommand({
  name: "clear",
  description: "Clear all context and start a new session",
  handler: async (_args, ctx): Promise<void> => {
    ctx.agent.clearSession();
    ctx.tokenCount$.set(0);
    const newSession = `session-${Date.now()}`;
    await switchSession({
      agent: ctx.agent,
      sessionManager: ctx.sessionManager,
      sessionName: newSession,
      setCurrentSession: ctx.setCurrentSession,
      sessionStats: ctx.sessionStats,
      statusMessage: "(Cleared)",
    });
  },
});
