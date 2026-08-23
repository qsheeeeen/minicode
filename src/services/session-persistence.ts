/**
 * SessionPersistence — static utility for session file I/O.
 *
 * Handles loading, appending, rewriting, listing, renaming, and deleting
 * session JSONL files. Pure I/O — no in-memory state.
 *
 * File format v2 (append-only tree): line 1 is `{"version":2}`; every
 * following line is a SessionEntry — a "turn" (user message + what followed)
 * or a "leaf" (active-pointer + state snapshot, last one wins). v1 files
 * (header + flat block lines) are detected and migrated on first save.
 */
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { MINICODE_HOME } from "../utils/paths.js";
import type { LLMBlock } from "../core/blocks.js";
import type { SessionEntry, TurnEntry, LeafEntry } from "./session-tree.js";

/** What loadTree returns: a parsed v2 tree, or the raw blocks of a v1 file. */
export type LoadedSession =
  | {
      version: 2;
      turns: TurnEntry[];
      activeTurnId: string | null;
      model: string;
      totalTokens: number;
    }
  | {
      version: 1;
      blocks: LLMBlock[];
      model: string;
      totalTokens: number;
    };

export interface SessionInfo {
  name: string;
  updatedAt: string;
}

interface SessionHeaderV1 {
  model: string;
  totalTokens: number;
  blockCount: number;
}

export class SessionPersistence {
  private static readonly BASE_DIR = path.join(MINICODE_HOME, "sessions");
  private static readonly EXT = ".context.jsonl";

  static getProjectHash(): string {
    return crypto
      .createHash("md5")
      .update(process.cwd())
      .digest("hex")
      .substring(0, 12);
  }

  static getSessionDir(): string {
    return path.join(
      SessionPersistence.BASE_DIR,
      SessionPersistence.getProjectHash(),
    );
  }

  /** Read a session file. v2 files parse into turn entries + the last leaf
   *  snapshot; v1 files return their raw blocks for migration. Null means
   *  "no such session". Malformed lines are skipped. */
  static async loadTree(name: string): Promise<LoadedSession | null> {
    // Read path — no mkdir side effect.
    const filePath = path.join(
      SessionPersistence.getSessionDir(),
      `${name}${SessionPersistence.EXT}`,
    );
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return null;
      const header = JSON.parse(lines[0]);
      if (header && header.version === 2) {
        return SessionPersistence.parseV2(lines.slice(1));
      }
      const v1 = header as SessionHeaderV1;
      const blocks: LLMBlock[] = [];
      for (let i = 1; i < lines.length; i++) {
        try {
          blocks.push(JSON.parse(lines[i]));
        } catch {
          // skip malformed lines
        }
      }
      return {
        version: 1,
        blocks,
        model: v1.model ?? "unknown",
        totalTokens: v1.totalTokens ?? 0,
      };
    } catch {
      return null;
    }
  }

  private static parseV2(lines: string[]): LoadedSession {
    // Map keyed by id: a turn appended twice (refreshed blocks) keeps the
    // later line — the file is a log, last write wins.
    const turns = new Map<string, TurnEntry>();
    let leaf: LeafEntry | undefined;
    for (const line of lines) {
      let entry: SessionEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type === "turn") {
        turns.set(entry.id, entry);
      } else if (entry?.type === "leaf") {
        leaf = entry;
      }
    }
    const list = [...turns.values()];
    // NB: a leaf line pointing at null (fork to before the first message) is
    // valid — only a file with NO leaf line falls back to the last turn.
    const activeTurnId = leaf
      ? leaf.activeTurnId
      : list.length > 0
        ? list[list.length - 1].id
        : null;
    return {
      version: 2,
      turns: list,
      activeTurnId:
        activeTurnId !== null && turns.has(activeTurnId) ? activeTurnId : null,
      model: leaf?.model ?? "unknown",
      totalTokens: leaf?.totalTokens ?? 0,
    };
  }

  /** Append entry lines to the session log (the common save path). A new
   *  file starts with the v2 header — callers serialize via saveChain, so
   *  the exists-check can't race another append. */
  static async appendEntries(
    sessionName: string,
    entries: readonly SessionEntry[],
  ): Promise<void> {
    if (!sessionName || entries.length === 0) return;
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionName}${SessionPersistence.EXT}`);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(
        filePath,
        JSON.stringify({ version: 2 }) + "\n",
        "utf-8",
      );
    }
    const payload = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.appendFile(filePath, payload, "utf-8");
  }

  /** Rewrite the whole log atomically (v1 migration, undo/abort rollback,
   *  compression rebuild). */
  static async rewriteTree(
    sessionName: string,
    entries: readonly SessionEntry[],
  ): Promise<void> {
    if (!sessionName) return;
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionName}${SessionPersistence.EXT}`);
    const tmpPath = filePath + ".tmp";
    const lines = [
      JSON.stringify({ version: 2 }),
      ...entries.map((e) => JSON.stringify(e)),
    ];
    await fs.writeFile(tmpPath, lines.join("\n") + "\n");
    await fs.rename(tmpPath, filePath);
  }

  static async list(): Promise<SessionInfo[]> {
    // Read path — no mkdir side effect.
    const dir = SessionPersistence.getSessionDir();
    const entries = await fs.readdir(dir).catch(() => []);
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(SessionPersistence.EXT))
        .map(async (entry) => {
          const name = entry.replace(SessionPersistence.EXT, "");
          try {
            const stat = await fs.stat(path.join(dir, entry));
            return { name, updatedAt: stat.mtime.toISOString() };
          } catch {
            return null; // skip unreadable files
          }
        }),
    );
    return sessions
      .filter((s): s is SessionInfo => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  static async delete(name: string): Promise<void> {
    const dir = SessionPersistence.getSessionDir();
    const paths = [
      path.join(dir, `${name}${SessionPersistence.EXT}`),
      path.join(dir, `${name}.json`),
    ];
    for (const filePath of paths) {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }
  }

  static async rename(oldName: string, newName: string): Promise<void> {
    // The old file must already exist for a rename — no mkdir needed.
    const dir = SessionPersistence.getSessionDir();
    const oldPath = path.join(dir, `${oldName}${SessionPersistence.EXT}`);
    const newPath = path.join(dir, `${newName}${SessionPersistence.EXT}`);
    await fs.rename(oldPath, newPath).catch(() => {});
  }

  static async getMostRecent(): Promise<string | null> {
    const sessions = await SessionPersistence.list();
    return sessions.length > 0 ? sessions[0].name : null;
  }
}
