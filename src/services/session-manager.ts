// SessionManager owns all session-level state: message store, change journal,
// session name, turn index, and session stats.
//
// Coordinates store.setSessionName + changeJournal.startSession on session
// switch. Agent delegates session operations here.

import { MessageStore } from "../messages.js";
import { ChangeJournal } from "./change-journal.js";
import type { SessionStats } from "./session-stats.js";
import type { MessageParam } from "../messages.js";

export class SessionManager {
  private _currentSession: string;
  private store = new MessageStore();
  private changeJournal = new ChangeJournal();
  private activeTurnIdx = 0;
  private sessionStats?: SessionStats;

  constructor(sessionName?: string, sessionStats?: SessionStats) {
    this._currentSession = sessionName ?? `session-${Date.now()}`;
    this.sessionStats = sessionStats;
  }

  /** Switch to a new session. Coordinates store + journal. */
  setSession(sessionName: string): void {
    this._currentSession = sessionName;
    this.store.setSessionName(sessionName);
    this.changeJournal.startSession(
      MessageStore.getSessionDir(),
      sessionName,
    );
  }

  /** Clear all session state (messages, journal, turn index). */
  clearSession(): void {
    this.store.clear();
    this.changeJournal.close();
    this.changeJournal = new ChangeJournal();
    this.activeTurnIdx = 0;
  }

  /** Persist session to disk. Caller provides model name and token count. */
  async saveStore(meta: {
    model: string;
    totalTokens: number;
  }): Promise<void> {
    this.store.setMeta(meta);
    await this.store.save().catch((e) => {
      // Caller should handle logging if needed
      throw e;
    });
  }

  // -- Store accessors --

  getStore(): MessageStore {
    return this.store;
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

  // -- Convenience shortcuts for common store operations --

  getMessages(): MessageParam[] {
    return this.store.getTurns();
  }

  setMessages(messages: MessageParam[]): void {
    this.store.setTurns(messages);
  }

  getSessionStats(): SessionStats | undefined {
    return this.sessionStats;
  }
}
