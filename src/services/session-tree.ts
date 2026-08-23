/** SessionTree — the in-memory conversation tree behind session persistence.
 *
 * Pure structure, no IO. Turns chain by parentId; the active-turn pointer is
 * the "leaf". Persistence appends turns and leaf snapshots; undo/abort remove
 * subtrees; fork moves the pointer without deleting anything.
 */

import type { LLMBlock } from "../core/blocks.js";

/** One persisted turn: the user message (blocks[0], id === entry id) plus
 *  everything produced before the next user message. */
export interface TurnEntry {
  type: "turn";
  id: string;
  parentId: string | null;
  ts: number;
  blocks: LLMBlock[];
}

/** Active-leaf pointer + state snapshot, appended on every save; the last
 *  line in the file wins on load. */
export interface LeafEntry {
  type: "leaf";
  ts: number;
  activeTurnId: string | null;
  model: string;
  totalTokens: number;
}

export type SessionEntry = TurnEntry | LeafEntry;

/** One user-message segment of the live context: the user block (with its
 *  stable id) and every block that follows it. */
export interface ContextSegment {
  messageId: string;
  blocks: LLMBlock[];
}

/** Split live blocks into user-message segments. Blocks before the first
 *  user message have no segment — unreachable in practice (every context
 *  starts with a user message). */
export function splitSegments(blocks: readonly LLMBlock[]): ContextSegment[] {
  const segments: ContextSegment[] = [];
  for (const block of blocks) {
    if (block.type === "user" && block.id) {
      segments.push({ messageId: block.id, blocks: [block] });
    } else if (segments.length > 0) {
      segments[segments.length - 1].blocks.push(block);
    }
  }
  return segments;
}

export class SessionTree {
  private turns = new Map<string, TurnEntry>();
  private _activeTurnId: string | null = null;

  static empty(): SessionTree {
    return new SessionTree();
  }

  /** Build from persisted turn entries (load path). */
  static fromTurns(
    turns: readonly TurnEntry[],
    activeTurnId: string | null,
  ): SessionTree {
    const tree = new SessionTree();
    for (const turn of turns) {
      tree.turns.set(turn.id, turn);
    }
    tree._activeTurnId =
      activeTurnId !== null && tree.turns.has(activeTurnId)
        ? activeTurnId
        : null;
    return tree;
  }

  /** Flatten a linear block history into a single-chain tree. Entry ids come
   *  from user-block ids (v1 migration runs after replaceBlocks normalized
   *  them). */
  static fromBlocks(blocks: readonly LLMBlock[]): SessionTree {
    const tree = new SessionTree();
    for (const segment of splitSegments(blocks)) {
      tree.appendTurn(segment.messageId, segment.blocks);
    }
    return tree;
  }

  get activeTurnId(): string | null {
    return this._activeTurnId;
  }

  has(id: string): boolean {
    return this.turns.has(id);
  }

  get(id: string): TurnEntry | undefined {
    return this.turns.get(id);
  }

  /** All persisted turns, in insertion order. */
  entries(): TurnEntry[] {
    return [...this.turns.values()];
  }

  /** Direct children of a turn (null = roots). */
  childrenOf(id: string | null): TurnEntry[] {
    return this.entries().filter((turn) => turn.parentId === id);
  }

  /** Append a turn after the active turn. Idempotent on message id. */
  appendTurn(messageId: string, blocks: readonly LLMBlock[]): void {
    if (this.turns.has(messageId)) return;
    this.turns.set(messageId, {
      type: "turn",
      id: messageId,
      parentId: this._activeTurnId,
      ts: Date.now(),
      blocks: [...blocks],
    });
    this._activeTurnId = messageId;
  }

  /** Move the active pointer — fork is non-destructive. */
  setActiveTurn(id: string | null): void {
    if (id !== null && !this.turns.has(id)) {
      throw new Error(`SessionTree: unknown turn ${id}`);
    }
    this._activeTurnId = id;
  }

  /** Turn entries from root to the active turn. */
  activePath(): TurnEntry[] {
    const path: TurnEntry[] = [];
    for (let id = this._activeTurnId; id; ) {
      const turn = this.turns.get(id);
      if (!turn) break;
      path.push(turn);
      id = turn.parentId;
    }
    return path.reverse();
  }

  /** The blocks of the active path — what a restored context looks like. */
  activePathBlocks(): LLMBlock[] {
    return this.activePath().flatMap((turn) => turn.blocks);
  }

  /** Remove a turn and its whole subtree — undo/abort, destructive. The
   *  active pointer falls back to the removed turn's parent. */
  truncateFrom(id: string): void {
    const root = this.turns.get(id);
    if (!root) return;
    const remove = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (remove.has(current)) continue;
      remove.add(current);
      for (const turn of this.turns.values()) {
        if (turn.parentId === current) stack.push(turn.id);
      }
    }
    for (const removed of remove) this.turns.delete(removed);
    if (this._activeTurnId !== null && remove.has(this._activeTurnId)) {
      this._activeTurnId = root.parentId;
    }
  }
}
