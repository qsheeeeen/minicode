import type { SessionStats } from "./session-stats.js";
import type { SessionManager } from "./session-manager.js";
import { createLogger } from "../utils/logger.js";
import { SessionPersistence, type SessionData } from "./session-persistence.js";
import type { RuntimeState } from "./runtime-state.js";
import type { ContextManager } from "./context-manager.js";

/** Activate a session: fresh logger, name, journal — the one triple every
 *  switch/restore/rename needs. */
async function activateSession(
  sessionManager: SessionManager,
  runtimeState: RuntimeState,
  name: string,
): Promise<void> {
  const logger = await createLogger(SessionPersistence.getProjectHash(), name);
  sessionManager.setSession(name);
  runtimeState.setLogger(logger);
}

export interface SessionSwitchOptions {
  sessionManager: SessionManager;
  sessionName: string;
  runtimeState: RuntimeState;
  sessionStats: SessionStats;
  statusMessage?: string;
}

export async function switchSession(opts: SessionSwitchOptions): Promise<void> {
  await activateSession(opts.sessionManager, opts.runtimeState, opts.sessionName);
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
  /** Prefetched session data (started earlier to overlap other startup I/O). */
  preload?: Promise<SessionData | null>;
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
  const { sessionManager, contextManager, runtimeState, name, load, preload } =
    opts;

  if (load) {
    const data = await (preload ?? SessionPersistence.load(name));
    if (data) {
      sessionManager.getContext().replaceBlocks(data.blocks);
      if ((data.totalTokens ?? 0) > 0) {
        contextManager.setTokenCount(data.totalTokens!);
      }
      await activateSession(sessionManager, runtimeState, name);
      return { loaded: true };
    }
  }
  await activateSession(sessionManager, runtimeState, name);
  return { loaded: false };
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
  const data = await SessionPersistence.load(name);
  if (!data) return { loaded: false };
  sessionManager.getContext().replaceBlocks(data.blocks);
  if ((data.totalTokens ?? 0) > 0) {
    contextManager.setTokenCount(data.totalTokens!);
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
  await activateSession(sessionManager, runtimeState, newName);
  sessionManager.reportStatus({
    role: "status",
    content: `Renamed: ${oldName} -> ${newName}`,
    timestamp: new Date(),
  });
}
