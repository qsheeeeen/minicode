// SessionManager owns all session-level state: context manager, change journal,
// session name, turn index, and session stats.
//
// Coordinates contextManager + changeJournal on session switch.
// Provides StatusReporter callback for services to emit UI notifications.
// Agent delegates session operations here.

import { ContextStore } from "../context/index.js";
import { ChangeJournal } from "./change-journal.js";
import { SessionPersistence } from "./session-persistence.js";
import type { SessionStats } from "./session-stats.js";
import type { ContextTurn, StatusMessage } from "../messages.js";
/**
 * StatusReporter — callback for emitting UI status/error notifications.
 * Defined here (SessionManager) because this is the primary owner of
 * status reporting lifecycle. Other services (ContextManager, TokenTracker)
 * receive it as a dependency.
 */
export type StatusReporter = (msg: Omit<StatusMessage, "turnIndex">) => void;

export class SessionManager {
  private _currentSession: string;
  private context = new ContextStore();
  private changeJournal = new ChangeJournal();
  private activeTurnIdx = 0;
  private sessionStats?: SessionStats;
  private _meta = { model: "unknown", totalTokens: 0 };
  private _statusReporter: StatusReporter = () => {};

  constructor(sessionName?: string, sessionStats?: SessionStats) {
    this._currentSession = sessionName ?? `session-${Date.now()}`;
    this.sessionStats = sessionStats;
  }

  /** Set the status reporter callback (called by UI layer during wiring). */
  setStatusReporter(reporter: StatusReporter): void {
    this._statusReporter = reporter;
  }

  /** Get the status reporter for services to emit UI notifications. */
  getStatusReporter(): StatusReporter {
    return this._statusReporter;
  }

  /** Convenience: report a status via the configured reporter. */
  reportStatus(msg: Omit<StatusMessage, "turnIndex">): void {
    this._statusReporter(msg);
  }

  /** Switch to a new session. Coordinates context + journal. */
  setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.changeJournal.startSession(
      SessionPersistence.getSessionDir(),
      sessionName,
    );
  }

  /** Clear all session state (context, journal, turn index). */
  clearSession(): void {
    this.context.clear();
    this.changeJournal.close();
    this.changeJournal = new ChangeJournal();
    this.activeTurnIdx = 0;
  }

  /** Persist session to disk. Caller provides model name and token count. */
  async saveStore(meta: { model: string; totalTokens: number }): Promise<void> {
    if (meta.model !== undefined) this._meta.model = meta.model;
    if (meta.totalTokens !== undefined)
      this._meta.totalTokens = meta.totalTokens;
    await SessionPersistence.save(
      this._currentSession,
      this.context.getTurns(),
      { model: this._meta.model, totalTokens: this._meta.totalTokens },
    ).catch((e) => {
      throw e;
    });
  }

  // -- Context accessors --

  getContext(): ContextStore {
    return this.context;
  }

  getChangeJournal(): ChangeJournal {
    return this.changeJournal;
  }

  getSessionName(): string {
    return this._currentSession;
  }

  // -- Turn index --

  getActiveTurnIdx(): number {
    return this.activeTurnIdx;
  }

  setActiveTurnIdx(idx: number): void {
    this.activeTurnIdx = idx;
  }

  // -- Convenience shortcuts for common context operations --

  getMessages(): ContextTurn[] {
    return this.context.getTurns();
  }

  setMessages(messages: ContextTurn[]): void {
    this.context.replaceTurns(messages);
  }

  getSessionStats(): SessionStats | undefined {
    return this.sessionStats;
  }
}
