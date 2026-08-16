// SessionManager owns all session-level state: LLM context, change journal,
// session name, user message ordinal, and session stats.
//
// Coordinates context + changeJournal on session switch.
// Agent delegates session operations here.

import { LLMContext } from "../core/context.js";
import { ChangeJournal } from "./change-journal.js";
import { SessionPersistence } from "./session-persistence.js";
import type { SessionStats } from "./session-stats.js";
import type { LLMBlock } from "../core/blocks.js";
import { RuntimeEvents, type RuntimeStatusInput } from "./runtime-events.js";

export type StatusReporter = (msg: RuntimeStatusInput) => void;

export class SessionManager {
  private _currentSession: string;
  private context = new LLMContext();
  private changeJournal = new ChangeJournal();
  private activeUserMessageOrdinal = 0;
  private sessionStats?: SessionStats;
  private _meta = { model: "unknown", totalTokens: 0 };
  private events: RuntimeEvents;

  constructor(
    sessionName?: string,
    sessionStats?: SessionStats,
    events = new RuntimeEvents(),
    private persistent = true,
  ) {
    this._currentSession = sessionName ?? `session-${Date.now()}`;
    this.sessionStats = sessionStats;
    this.events = events;
  }

  /** Report a status event. */
  reportStatus(status: RuntimeStatusInput): void {
    this.events.emit({
      type: "status.added",
      status: {
        ...status,
        userMessageIndex:
          status.userMessageIndex ?? this.context.getUserMessageCount(),
      },
    });
  }

  /** Switch to a new session. Coordinates context + journal. */
  setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.changeJournal.startSession(
      SessionPersistence.getSessionDir(),
      sessionName,
    );
    this.events.emit({ type: "session.changed", sessionName });
  }

  /** Clear all session state (context, journal, user message ordinal). */
  clearSession(): void {
    this.context.clear();
    this.changeJournal.close();
    this.changeJournal = new ChangeJournal();
    this.activeUserMessageOrdinal = 0;
  }

  /** Persist session to disk. Caller provides model name and token count. */
  async saveStore(meta: { model: string; totalTokens: number }): Promise<void> {
    if (meta.model !== undefined) this._meta.model = meta.model;
    if (meta.totalTokens !== undefined)
      this._meta.totalTokens = meta.totalTokens;
    // Ephemeral sessions (sub-agents) never touch disk.
    if (!this.persistent) return;
    return SessionPersistence.save(
      this._currentSession,
      this.context.getBlocks(),
      { model: this._meta.model, totalTokens: this._meta.totalTokens },
    );
  }

  // -- Context accessors --

  getContext(): LLMContext {
    return this.context;
  }

  getChangeJournal(): ChangeJournal {
    return this.changeJournal;
  }

  getSessionName(): string {
    return this._currentSession;
  }

  // -- User message ordinal --

  getActiveUserMessageOrdinal(): number {
    return this.activeUserMessageOrdinal;
  }

  setActiveUserMessageOrdinal(idx: number): void {
    this.activeUserMessageOrdinal = idx;
  }

  // -- Convenience shortcuts for common context operations --

  getMessages(): LLMBlock[] {
    return this.context.getBlocks();
  }

  setMessages(messages: LLMBlock[]): void {
    this.context.replaceBlocks(messages);
  }

  getSessionStats(): SessionStats | undefined {
    return this.sessionStats;
  }
}
