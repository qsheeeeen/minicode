import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const BASE_SESSIONS_DIR = path.join(os.homedir(), '.minicode', 'sessions');

// Simple error logging (could be replaced with proper logger)
function logError(operation: string, error: unknown): void {
  if (process.env.DEBUG) {
    console.error(`[SessionManager] ${operation}:`, error);
  }
}

export interface SessionData {
  model: string;
  messages: Array<{ role: string; content: any }>;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  name: string;
  updatedAt: string;
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
    return crypto.createHash('md5').update(cwd).digest('hex').substring(0, 12);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
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
      if (!entry.endsWith('.json')) continue;
      const name = entry.replace('.json', '');
      const data = await this.get(name);
      if (data) {
        sessions.push({ name, updatedAt: data.updatedAt });
      }
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listNames(): Promise<string[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.sessionsDir).catch(() => []);
    return entries.filter(e => e.endsWith('.json')).map(e => e.replace('.json', ''));
  }

  async getMostRecent(): Promise<string | null> {
    const sessions = await this.list();
    return sessions.length > 0 ? sessions[0].name : null;
  }

  async get(name: string): Promise<SessionData | null> {
    await this.ensureDir();
    const filePath = path.join(this.sessionsDir, `${name}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logError(`failed to read session ${name}`, error);
      return null;
    }
  }

  async save(name: string, data: SessionData): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.sessionsDir, `${name}.json`);
    const now = new Date().toISOString();
    data.updatedAt = now;
    if (!data.createdAt) {
      data.createdAt = now;
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async delete(name: string): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.sessionsDir, `${name}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logError(`failed to delete session ${name}`, error);
    }
  }

  async rename(oldName: string, newName: string): Promise<void> {
    await this.ensureDir();
    const oldPath = path.join(this.sessionsDir, `${oldName}.json`);
    const newPath = path.join(this.sessionsDir, `${newName}.json`);
    try {
      await fs.rename(oldPath, newPath);
    } catch (error) {
      logError(`failed to rename session ${oldName} to ${newName}`, error);
    }
  }
}

export const sessionManager = new SessionManager();
