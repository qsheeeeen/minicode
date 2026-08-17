/**
 * SessionPersistence — static utility for session file I/O.
 *
 * Extracted from MessageStore's static methods. Handles loading,
 * saving, listing, renaming, and deleting session JSONL files.
 * Pure I/O — no in-memory state.
 */
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { MINICODE_HOME } from "../utils/paths.js";
import type { LLMBlock } from "../core/blocks.js";

export interface SessionData {
  model: string;
  blocks: LLMBlock[];
  totalTokens: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionInfo {
  name: string;
  updatedAt: string;
}

interface SessionHeader {
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

  static async save(
    sessionName: string,
    blocks: readonly LLMBlock[],
    meta: { model: string; totalTokens: number },
  ): Promise<void> {
    if (!sessionName) return;
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionName}${SessionPersistence.EXT}`);
    const tmpPath = filePath + ".tmp";
    const header: SessionHeader = {
      model: meta.model,
      totalTokens: meta.totalTokens,
      blockCount: blocks.length,
    };
    const lines = [JSON.stringify(header)];
    for (const block of blocks) {
      lines.push(JSON.stringify(block));
    }
    await fs.writeFile(tmpPath, lines.join("\n") + "\n");
    await fs.rename(tmpPath, filePath);
  }

  static async load(name: string): Promise<SessionData | null> {
    // Read path — no mkdir side effect. null means "no such session".
    const filePath = path.join(
      SessionPersistence.getSessionDir(),
      `${name}${SessionPersistence.EXT}`,
    );
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return null;
      const header: SessionHeader = JSON.parse(lines[0]);
      const blocks: LLMBlock[] = [];
      for (let i = 1; i < lines.length; i++) {
        try {
          blocks.push(JSON.parse(lines[i]));
        } catch {
          // skip malformed lines
        }
      }
      return {
        model: header.model,
        blocks,
        totalTokens: header.totalTokens,
      };
    } catch {
      return null;
    }
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
