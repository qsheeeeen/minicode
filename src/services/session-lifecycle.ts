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

/** Load persisted blocks/token count into the live context. */
async function loadInto(
  sessionManager: SessionManager,
  contextManager: ContextManager,
  name: string,
): Promise<boolean> {
  const data = await SessionPersistence.load(name);
  if (!data) return false;

  sessionManager.getContext().replaceBlocks(data.blocks);
  if ((data.totalTokens ?? 0) > 0) {
    contextManager.setTokenCount(data.totalTokens!);
  }
  return true;
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

  if (!(await loadInto(sessionManager, contextManager, name))) {
    return { loaded: false };
  }
  const logger = await createLogger(SessionPersistence.getProjectHash(), name);
  runtimeState.setLogger(logger);
  return { loaded: true };
}

export interface ResumeSessionOptions {
  sessionManager: SessionManager;
  contextManager: ContextManager;
  runtimeState: RuntimeState;
  sessionStats: SessionStats;
  name: string;
}

/**
 * Load a persisted session into the runtime and activate it — the single
 * path for switching to an existing session (blocks, tokens, logger, stats,
 * status all owned here).
 */
export async function resumeSession(
  opts: ResumeSessionOptions,
): Promise<RestoreSessionResult> {
  const { sessionManager, contextManager, runtimeState, sessionStats, name } =
    opts;
  if (!(await loadInto(sessionManager, contextManager, name))) {
    return { loaded: false };
  }
  await switchSession({
    sessionManager,
    sessionName: name,
    runtimeState,
    sessionStats,
    statusMessage: `Loaded session: ${name}`,
  });
  return { loaded: true };
}

export interface RenameSessionOptions {
  sessionManager: SessionManager;
  runtimeState: RuntimeState;
  oldName: string;
  newName: string;
}

/** Rename the active session: persistence, logger, and status in one place. */
export async function renameSession(opts: RenameSessionOptions): Promise<void> {
  const { sessionManager, runtimeState, oldName, newName } = opts;
  await SessionPersistence.rename(oldName, newName);
  const logger = await createLogger(
    SessionPersistence.getProjectHash(),
    newName,
  );
  sessionManager.setSession(newName);
  runtimeState.setLogger(logger);
  sessionManager.reportStatus({
    role: "status",
    content: `Renamed: ${oldName} -> ${newName}`,
    timestamp: new Date(),
  });
}
