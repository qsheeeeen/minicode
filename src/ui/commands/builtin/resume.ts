import { registerCommand } from "../registry.js";
import { SessionPersistence } from "../../../services/session-persistence.js";
import { switchSession } from "../../../services/session-lifecycle.js";

registerCommand({
  name: "resume",
  description: "Load a session (without args: list sessions)",
  handler: async (args, ctx): Promise<void> => {
    if (args.length === 0) {
      const sessions = await SessionPersistence.list();
      ctx.presentInput({ type: "session-picker", sessions });
    } else {
      const name = args[0];
      const data = await SessionPersistence.load(name);
      if (data) {
        ctx.context.replaceBlocks(data.blocks);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          ctx.setTokenCount(totalTokens);
        }
        await switchSession({
          sessionManager: ctx.sessionManager,
          sessionName: name,
          setCurrentSession: ctx.setCurrentSession,
          setLogger: ctx.setLogger,
          sessionStats: ctx.sessionStats,
          statusMessage: `Loaded session: ${name}`,
        });
      } else {
        ctx.sessionManager.reportStatus({
          role: "error",
          content: `Session not found: ${name}`,
          timestamp: new Date(),
        });
      }
    }
  },
});
