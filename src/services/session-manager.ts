// SessionManager owns all session-level state: LLM context, change journal,
// session name, user message ordinal, and session stats.
//
// Coordinates context + changeJournal on session switch.
// Agent delegates session operations here.

import { LLMContext } from "../llm/context.js";
import { ChangeJournal } from "./change-journal.js";
import { SessionPersistence } from "./session-persistence.js";
import type { SessionStats } from "./session-stats.js";
import type { LLMBlock } from "../llm/context.js";
import type { StatusMessage } from "../ui/display.js";
import { RuntimeEvents } from "./runtime-events.js";

export type StatusReporter = (
  msg: Omit<StatusMessage, "userMessageIndex">,
) => void;

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
  ) {
    this._currentSession = sessionName ?? `session-${Date.now()}`;
    this.sessionStats = sessionStats;
    this.events = events;
  }

  /** Report a status event. */
  reportStatus(msg: Omit<StatusMessage, "userMessageIndex">): void {
    this.events.emit({ type: "status.added", message: msg });
  }

  /** Switch to a new session. Coordinates context + journal. */
  setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.changeJournal.startSession(
      SessionPersistence.getSessionDir(),
      sessionName,
    );
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
    await SessionPersistence.save(
      this._currentSession,
      this.context.getBlocks(),
      { model: this._meta.model, totalTokens: this._meta.totalTokens },
    ).catch((e) => {
      throw e;
    });
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
