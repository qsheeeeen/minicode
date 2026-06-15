import { registerCommand } from "../registry.js";
import { SessionPersistence } from "../../../services/session-persistence.js";
import { createLogger } from "../../../utils/logger.js";

registerCommand({
  name: "rename",
  description: "Rename current session",
  handler: async (args, ctx): Promise<void> => {
    const newName = args.join(" ");
    if (newName) {
      const oldName = ctx.sessionManager.getSessionName();
      await SessionPersistence.rename(oldName, newName);
      const newLogger = await createLogger(
        SessionPersistence.getProjectHash(),
        newName,
      );
      ctx.sessionManager.setSession(newName);
      ctx.setLogger(newLogger);
      ctx.setCurrentSession(newName);
      ctx.sessionManager.reportStatus({
        role: "status",
        content: `Renamed: ${oldName} -> ${newName}`,
        timestamp: new Date(),
      });
    }
  },
});
