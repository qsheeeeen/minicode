import { registerCommand } from "../registry.js";
import { switchSession } from "../../../services/session-lifecycle.js";

registerCommand({
  name: "new",
  description: "Create a new session",
  handler: async (args, ctx): Promise<void> => {
    const name = args.join(" ");
    if (name) {
      ctx.sessionManager.clearSession();
      ctx.contextManager.reset();
      await switchSession({
        sessionManager: ctx.sessionManager,
        sessionName: name,
        setCurrentSession: ctx.setCurrentSession,
        setLogger: ctx.setLogger,
        sessionStats: ctx.sessionStats,
        statusMessage: `Created session: ${name}`,
      });
    }
  },
});
