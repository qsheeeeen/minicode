// SessionManager owns all session-level state: LLM context, change journal,
// session name, user message ordinal, and session stats.
//
// Coordinates context + changeJournal on session switch.
// Agent delegates session operations here.

import { LLMContext } from "../core/context.js";
import { ChangeJournal } from "./change-journal.js";
import { SessionPersistence } from "./session-persistence.js";
import { RuntimeEvents, type RuntimeStatus } from "./runtime-events.js";

export type StatusReporter = (msg: RuntimeStatus) => void;

/** Single owner of the default session-name scheme. */
export function newSessionName(): string {
  return `session-${Date.now()}`;
}

export class SessionManager {
  private _currentSession: string;
  private context = new LLMContext();
  private changeJournal = new ChangeJournal();
  private activeUserMessageOrdinal = 0;
  private _meta = { model: "unknown", totalTokens: 0 };
  private events: RuntimeEvents;

  constructor(
    sessionName?: string,
    events = new RuntimeEvents(),
    private persistent = true,
  ) {
    this._currentSession = sessionName ?? newSessionName();
    this.events = events;
  }

  /** Report a status event. */
  reportStatus(status: RuntimeStatus): void {
    this.events.emitStatus(status, this.context.getUserMessageCount());
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

  private saveChain: Promise<void> = Promise.resolve();

  /** Persist session to disk. Caller provides model name and token count.
   *  Saves are serialized: the agent fires some without awaiting, and
   *  concurrent tmp-write/rename pairs on one file would interleave. */
  async saveStore(meta: { model: string; totalTokens: number }): Promise<void> {
    this._meta = meta;
    // Ephemeral sessions (sub-agents) never touch disk.
    if (!this.persistent) return;
    const run = this.saveChain.then(() =>
      SessionPersistence.save(
        this._currentSession,
        this.context.getBlocksReadonly(),
        {
          model: this._meta.model,
          totalTokens: this._meta.totalTokens,
        },
      ),
    );
    // A failed save must not poison the chain for the next one.
    this.saveChain = run.catch(() => {});
    return run;
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
}
