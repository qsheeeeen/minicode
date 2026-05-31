import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const BASE_SESSIONS_DIR = path.join(os.homedir(), ".minicode", "sessions");
const EXT = ".context.jsonl";

interface SessionHeader {
  model: string;
  totalTokens: number;
  msgCount: number;
}

export interface SessionData {
  model: string;
  messages: Array<{ role: string; content: any }>;
  totalTokens: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionInfo {
  name: string;
  updatedAt: string;
}

function logError(operation: string, error: unknown): void {
  if (process.env.DEBUG) {
    console.error(`[SessionManager] ${operation}:`, error);
  }
}

export class SessionManager {
  private readonly projectHash: string;
  private readonly sessionsDir: string;

  constructor() {
    this.projectHash = this.computeProjectHash();
    this.sessionsDir = path.join(BASE_SESSIONS_DIR, this.projectHash);
  }

  private computeProjectHash(): string {
    const cwd = process.cwd();
    return crypto.createHash("md5").update(cwd).digest("hex").substring(0, 12);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  private sessionPath(name: string): string {
    return path.join(this.sessionsDir, `${name}${EXT}`);
  }

  getProjectHash(): string {
    return this.projectHash;
  }

  getSessionDir(): string {
    return this.sessionsDir;
  }

  async list(): Promise<SessionInfo[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.sessionsDir).catch(() => []);
    const sessions: SessionInfo[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(EXT)) continue;
      const name = entry.replace(EXT, "");
      try {
        const stat = await fs.stat(this.sessionPath(name));
        sessions.push({ name, updatedAt: stat.mtime.toISOString() });
      } catch {
        // skip unreadable files
      }
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listNames(): Promise<string[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.sessionsDir).catch(() => []);
    return entries.filter((e) => e.endsWith(EXT)).map((e) => e.replace(EXT, ""));
  }

  async getMostRecent(): Promise<string | null> {
    const sessions = await this.list();
    return sessions.length > 0 ? sessions[0].name : null;
  }

  async get(name: string): Promise<SessionData | null> {
    await this.ensureDir();
    const filePath = this.sessionPath(name);

    // Try JSONL format first
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

    // Fallback: legacy .json format
    const legacyPath = path.join(this.sessionsDir, `${name}.json`);
    try {
      const content = await fs.readFile(legacyPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      logError(`failed to read session ${name}`, error);
      return null;
    }
  }

  async save(name: string, data: SessionData): Promise<void> {
    await this.ensureDir();
    const filePath = this.sessionPath(name);
    const tmpPath = filePath + ".tmp";

    const header: SessionHeader = {
      model: data.model,
      totalTokens: data.totalTokens,
      msgCount: data.messages.length,
    };

    const lines: string[] = [JSON.stringify(header)];
    for (const msg of data.messages) {
      lines.push(JSON.stringify(msg));
    }

    // Atomic write: write to tmp then rename
    await fs.writeFile(tmpPath, lines.join("\n") + "\n");
    await fs.rename(tmpPath, filePath);
  }

  async delete(name: string): Promise<void> {
    await this.ensureDir();
    // Try JSONL first, then legacy .json
    const paths = [this.sessionPath(name), path.join(this.sessionsDir, `${name}.json`)];
    for (const filePath of paths) {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }
  }

  async rename(oldName: string, newName: string): Promise<void> {
    await this.ensureDir();
    const oldPath = this.sessionPath(oldName);
    const newPath = this.sessionPath(newName);
    try {
      await fs.rename(oldPath, newPath);
    } catch (error) {
      logError(`failed to rename session ${oldName} to ${newName}`, error);
    }
  }
}

export const sessionManager = new SessionManager();
