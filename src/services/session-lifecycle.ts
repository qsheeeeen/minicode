import type { SessionStats } from "./session-stats.js";
import type { SessionManager } from "./session-manager.js";
import { createLogger } from "../utils/logger.js";
import { SessionPersistence } from "./session-persistence.js";
import type { RuntimeState } from "./runtime-state.js";

export interface SessionSwitchOptions {
  sessionManager: SessionManager;
  sessionName: string;
  runtimeState: RuntimeState;
  sessionStats: SessionStats;
  statusMessage?: string;
}

export async function switchSession(opts: SessionSwitchOptions): Promise<void> {
  const logger = await createLogger(
    SessionPersistence.getProjectHash(),
    opts.sessionName,
  );
  opts.sessionManager.setSession(opts.sessionName);
  opts.runtimeState.setLogger(logger);
  opts.sessionStats.incrementSessionCount(opts.sessionName);
  if (opts.statusMessage) {
    opts.sessionManager.reportStatus({
      role: "status",
      content: opts.statusMessage,
      timestamp: new Date(),
    });
  }
}
