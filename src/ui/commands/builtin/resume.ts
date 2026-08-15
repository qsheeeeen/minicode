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
      const { loaded } = await ctx.resumeSession(name);
      if (!loaded) {
        ctx.sessionManager.reportStatus({
          role: "error",
          content: `Session not found: ${name}`,
          timestamp: new Date(),
        });
      }
    }
  },
};
