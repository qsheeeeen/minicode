// SessionManager owns all session-level state: LLM context, conversation
// tree, change journal, session name, active message id, and session stats.
//
// Coordinates context + changeJournal on session switch.
// Agent delegates session operations here.

import { LLMContext } from "../core/context.js";
import { ChangeJournal } from "./change-journal.js";
import {
  SessionPersistence,
  type LoadedSession,
} from "./session-persistence.js";
import { RuntimeEvents, type RuntimeStatus } from "./runtime-events.js";
import {
  SessionTree,
  splitSegments,
  type ContextSegment,
  type LeafEntry,
  type SessionEntry,
} from "./session-tree.js";

export type StatusReporter = (msg: RuntimeStatus) => void;

/** Single owner of the default session-name scheme. */
export function newSessionName(): string {
  return `session-${Date.now()}`;
}

export class SessionManager {
  private _currentSession: string;
  private context = new LLMContext();
  private changeJournal = new ChangeJournal();
  private activeMessageId: string | undefined;
  private _meta = { model: "unknown", totalTokens: 0 };
  private events: RuntimeEvents;
  private tree = SessionTree.empty();
  /** Set when the on-disk file is not v2: the next save rewrites it whole. */
  private needsRewrite = false;

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

  /** Switch to a new session. Coordinates context + journal. Awaited so a
   *  rapid switch can't load one session's journal into another. */
  async setSession(sessionName: string): Promise<void> {
    this._currentSession = sessionName;
    await this.changeJournal.startSession(
      SessionPersistence.getSessionDir(),
      sessionName,
    );
    this.events.emit({ type: "session.changed", sessionName });
  }

  /** Clear all session state (context, tree, journal, active message). */
  clearSession(): void {
    this.context.clear();
    this.changeJournal.close();
    this.changeJournal = new ChangeJournal();
    this.activeMessageId = undefined;
    this.tree = SessionTree.empty();
    this.needsRewrite = false;
  }

  /** Load a persisted session into memory. v2 restores the tree as saved
   *  (active path becomes the context); v1 histories are normalized to
   *  stable ids and marked for a full v2 rewrite on first save. */
  restoreFrom(loaded: LoadedSession): void {
    if (loaded.version === 2) {
      this.tree = SessionTree.fromTurns(loaded.turns, loaded.activeTurnId);
      this.context.replaceBlocks(this.tree.activePathBlocks());
      this.needsRewrite = false;
    } else {
      this.context.replaceBlocks(loaded.blocks); // assigns stable user ids
      this.tree = SessionTree.fromBlocks(this.context.getBlocksReadonly());
      this.needsRewrite = true;
    }
  }

  /** The conversation tree (read-only use: /tree, /fork pickers). */
  getTree(): SessionTree {
    return this.tree;
  }

  private saveChain: Promise<void> = Promise.resolve();

  /** Persist session to disk. Caller provides model name and token count;
   *  omitted meta reuses the last known values (command-layer saves like
   *  /undo and /fork have neither). Saves are serialized: the agent fires
   *  some without awaiting, and interleaved writes on one file would
   *  corrupt it. `final` marks the end of a run — the in-flight tail turn
   *  is appended too. */
  async saveStore(
    meta?: { model: string; totalTokens: number },
    opts?: { final?: boolean },
  ): Promise<void> {
    if (meta) this._meta = meta;
    // Ephemeral sessions (sub-agents) never touch disk.
    if (!this.persistent) return;
    const run = this.saveChain.then(() =>
      this.syncTree(opts?.final === true),
    );
    // A failed save must not poison the chain for the next one.
    this.saveChain = run.catch(() => {});
    return run;
  }

  /** Reconcile the in-memory tree with the live context, then write. Four
   *  shapes, one rule each:
   *  ① context extends the active path → append newly completed turns;
   *  ② final → the tail turn is complete, append it too;
   *  ③ context is a strict prefix (abort/undo) → drop the extra subtree and
   *    rewrite the file (destructive);
   *  ④ divergence (compression rebuilt the history) → rebuild the tree from
   *    context and rewrite (branch history is gone).
   *  Every save ends with a leaf line: active pointer + state snapshot. */
  private async syncTree(final: boolean): Promise<void> {
    const segments = splitSegments(this.context.getBlocksReadonly());
    const path = this.tree.activePath();
    let matched = 0;
    while (
      matched < path.length &&
      matched < segments.length &&
      segments[matched].messageId === path[matched].id
    ) {
      matched += 1;
    }

    if (matched === path.length) {
      // ①/② — extend. The tail segment is still growing unless this save is
      // final, so only completed segments are worth persisting.
      const newSegments = final
        ? segments.slice(matched)
        : segments.slice(matched, segments.length - 1);
      for (const segment of newSegments) {
        this.tree.appendTurn(segment.messageId, segment.blocks);
      }
      if (this.needsRewrite) {
        this.needsRewrite = false;
        await SessionPersistence.rewriteTree(
          this._currentSession,
          this.fileEntries(),
        );
        return;
      }
      await SessionPersistence.appendEntries(this._currentSession, [
        ...newSegments.map((s): SessionEntry => this.tree.get(s.messageId)!),
        this.leafEntry(),
      ]);
      return;
    }

    if (matched === segments.length) {
      // ③ — context lost the tail (abort/undo): destructive rollback.
      this.tree.truncateFrom(path[matched].id);
    } else {
      // ④ — divergence (compression): history rebuilt from context.
      this.rebuild(segments, final);
    }
    this.needsRewrite = false;
    await SessionPersistence.rewriteTree(
      this._currentSession,
      this.fileEntries(),
    );
  }

  /** Fresh single-chain tree from context segments (compression rebuild). */
  private rebuild(segments: readonly ContextSegment[], final: boolean): void {
    this.tree = SessionTree.empty();
    const kept = final ? segments : segments.slice(0, -1);
    for (const segment of kept) {
      this.tree.appendTurn(segment.messageId, segment.blocks);
    }
  }

  /** All tree turns + a closing leaf line — the full file body. */
  private fileEntries(): SessionEntry[] {
    return [...this.tree.entries(), this.leafEntry()];
  }

  private leafEntry(): LeafEntry {
    return {
      type: "leaf",
      ts: Date.now(),
      activeTurnId: this.tree.activeTurnId,
      model: this._meta.model,
      totalTokens: this._meta.totalTokens,
    };
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

  // -- Active user message --

  /** The user message file changes are journaled under (stable id). */
  getActiveMessageId(): string | undefined {
    return this.activeMessageId;
  }

  setActiveMessageId(id: string | undefined): void {
    this.activeMessageId = id;
  }
}
