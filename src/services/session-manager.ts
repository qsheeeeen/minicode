// SessionManager owns all session-level state: LLM history, change journal,
// session name, turn index, and session stats.
//
// Coordinates history + changeJournal on session switch.
// Provides StatusReporter callback for services to emit UI notifications.
// Agent delegates session operations here.

import { LLMHistory } from "../llm/history.js";
import { ChangeJournal } from "./change-journal.js";
import { SessionPersistence } from "./session-persistence.js";
import type { SessionStats } from "./session-stats.js";
import type { LLMBlock } from "../llm/history.js";
import type { StatusMessage } from "../ui/display.js";
/**
 * StatusReporter — callback for emitting UI status/error notifications.
 * Defined here (SessionManager) because this is the primary owner of
 * status reporting lifecycle. Other services (ContextManager, TokenTracker)
 * receive it as a dependency.
 */
export type StatusReporter = (msg: Omit<StatusMessage, "turnIndex">) => void;

export class SessionManager {
  private _currentSession: string;
  private history = new LLMHistory();
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

  /** Switch to a new session. Coordinates history + journal. */
  setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.changeJournal.startSession(
      SessionPersistence.getSessionDir(),
      sessionName,
    );
  }

  /** Clear all session state (history, journal, turn index). */
  clearSession(): void {
    this.history.clear();
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
      this.history.getBlocks(),
      { model: this._meta.model, totalTokens: this._meta.totalTokens },
    ).catch((e) => {
      throw e;
    });
  }

  // -- History accessors --

  getHistory(): LLMHistory {
    return this.history;
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

  // -- Convenience shortcuts for common history operations --

  getMessages(): LLMBlock[] {
    return this.history.getBlocks();
  }

  setMessages(messages: LLMBlock[]): void {
    this.history.replaceBlocks(messages);
  }

  getSessionStats(): SessionStats | undefined {
    return this.sessionStats;
  }
}
