import type { SessionStats } from "./session-stats.js";
import type { SessionManager } from "./session-manager.js";
import { createLogger } from "../utils/logger.js";
import { SessionPersistence } from "./session-persistence.js";
import type { RuntimeState } from "./runtime-state.js";
import type { ContextManager } from "./context-manager.js";

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

export interface RestoreSessionOptions {
  sessionManager: SessionManager;
  contextManager: ContextManager;
  runtimeState: RuntimeState;
  /** Already-resolved session name (CLI/config wins over "recent"). */
  name: string;
  /** Whether to attempt loading persisted blocks for this session. */
  load: boolean;
}

export interface RestoreSessionResult {
  loaded: boolean;
}

/**
 * Bootstrap a session into the runtime: activate the name, and when `load` is
 * set, restore persisted blocks/token count and point the logger at the
 * session's log file. Shared by headless and TUI so bootstrapping never
 * diverges between the two entry points.
 */
export async function restoreSession(
  opts: RestoreSessionOptions,
): Promise<RestoreSessionResult> {
  const { sessionManager, contextManager, runtimeState, name, load } = opts;
  sessionManager.setSession(name);
  if (!load) return { loaded: false };

  const data = await SessionPersistence.load(name);
  if (!data) return { loaded: false };

  sessionManager.getContext().replaceBlocks(data.blocks);
  if ((data.totalTokens ?? 0) > 0) {
    contextManager.setTokenCount(data.totalTokens!);
  }
  const logger = await createLogger(SessionPersistence.getProjectHash(), name);
  runtimeState.setLogger(logger);
  return { loaded: true };
}
