import type { CommandHandler } from "../registry.js";
import { SessionPersistence } from "../../../services/session-persistence.js";

export const resumeCommand: CommandHandler = {
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
        ctx.loadContext(data.blocks, data.totalTokens);
        await ctx.switchSession(name, {
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
};
