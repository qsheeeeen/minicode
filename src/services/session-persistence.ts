/**
 * SessionPersistence — static utility for session file I/O.
 *
 * Extracted from MessageStore's static methods. Handles loading,
 * saving, listing, renaming, and deleting session JSONL files.
 * Pure I/O — no in-memory state.
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { MessageParam } from "../messages.js";

export interface SessionData {
  model: string;
  messages: MessageParam[];
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
  msgCount: number;
}

export class SessionPersistence {
  private static readonly BASE_DIR = path.join(
    os.homedir(),
    ".minicode",
    "sessions",
  );
  private static readonly EXT = ".context.jsonl";

  static getProjectHash(): string {
    return crypto
      .createHash("md5")
      .update(process.cwd())
      .digest("hex")
      .substring(0, 12);
  }

  static getSessionDir(): string {
    return path.join(SessionPersistence.BASE_DIR, SessionPersistence.getProjectHash());
  }

  static async save(
    sessionName: string,
    turns: MessageParam[],
    meta: { model: string; totalTokens: number },
  ): Promise<void> {
    if (!sessionName) return;
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(
      dir,
      `${sessionName}${SessionPersistence.EXT}`,
    );
    const tmpPath = filePath + ".tmp";
    const header: SessionHeader = {
      model: meta.model,
      totalTokens: meta.totalTokens,
      msgCount: turns.length,
    };
    const lines = [JSON.stringify(header)];
    for (const msg of turns) {
      lines.push(JSON.stringify(msg));
    }
    await fs.writeFile(tmpPath, lines.join("\n") + "\n");
    await fs.rename(tmpPath, filePath);
  }

  static async load(name: string): Promise<SessionData | null> {
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}${SessionPersistence.EXT}`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return null;
      const header: SessionHeader = JSON.parse(lines[0]);
      const messages: SessionData["messages"] = [];
      for (let i = 1; i < lines.length; i++) {
        try {
          messages.push(JSON.parse(lines[i]));
        } catch {
          // skip malformed lines
        }
      }
      return {
        model: header.model,
        messages,
        totalTokens: header.totalTokens,
      };
    } catch {
      // JSONL not found, try legacy .json format
    }
    const legacyPath = path.join(dir, `${name}.json`);
    try {
      const content = await fs.readFile(legacyPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  static async list(): Promise<SessionInfo[]> {
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir).catch(() => []);
    const sessions: SessionInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(SessionPersistence.EXT)) continue;
      const name = entry.replace(SessionPersistence.EXT, "");
      try {
        const stat = await fs.stat(path.join(dir, entry));
        sessions.push({ name, updatedAt: stat.mtime.toISOString() });
      } catch {
        // skip unreadable files
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    const dir = SessionPersistence.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const oldPath = path.join(dir, `${oldName}${SessionPersistence.EXT}`);
    const newPath = path.join(dir, `${newName}${SessionPersistence.EXT}`);
    await fs.rename(oldPath, newPath).catch(() => {});
  }

  static async getMostRecent(): Promise<string | null> {
    const sessions = await SessionPersistence.list();
    return sessions.length > 0 ? sessions[0].name : null;
  }
}
