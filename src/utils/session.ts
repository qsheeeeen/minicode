import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const SESSIONS_DIR = path.join(os.homedir(), '.minicode', 'sessions');

export interface SessionData {
  model: string;
  messages: Array<{ role: string; content: any }>;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export async function getSessionDir(): Promise<string> {
  const projectHash = getProjectHash();
  const dir = path.join(SESSIONS_DIR, projectHash);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getProjectHash(): string {
  const cwd = process.cwd();
  return crypto.createHash('md5').update(cwd).digest('hex').substring(0, 12);
}

export async function listSessions(): Promise<string[]> {
  const dir = await getSessionDir();
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter(e => e.endsWith('.json')).map(e => e.replace('.json', ''));
}

export interface SessionInfo {
  name: string;
  updatedAt: string;
}

export async function listSessionsWithInfo(): Promise<SessionInfo[]> {
  const dir = await getSessionDir();
  const entries = await fs.readdir(dir).catch(() => []);
  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const name = entry.replace('.json', '');
    const data = await loadSession(name);
    if (data) {
      sessions.push({ name, updatedAt: data.updatedAt });
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMostRecentSession(): Promise<string | null> {
  const sessions = await listSessionsWithInfo();
  return sessions.length > 0 ? sessions[0].name : null;
}

export async function loadSession(name: string): Promise<SessionData | null> {
  const dir = await getSessionDir();
  const filePath = path.join(dir, `${name}.json`);
  const content = await fs.readFile(filePath, 'utf-8').catch(() => null);
  if (!content) return null;
  return JSON.parse(content);
}

export async function saveSession(name: string, data: SessionData): Promise<void> {
  const dir = await getSessionDir();
  const filePath = path.join(dir, `${name}.json`);
  data.updatedAt = new Date().toISOString();
  if (!data.createdAt) {
    data.createdAt = data.updatedAt;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function deleteSession(name: string): Promise<void> {
  const dir = await getSessionDir();
  const filePath = path.join(dir, `${name}.json`);
  await fs.unlink(filePath).catch(() => {});
}

export async function renameSession(oldName: string, newName: string): Promise<void> {
  const dir = await getSessionDir();
  const oldPath = path.join(dir, `${oldName}.json`);
  const newPath = path.join(dir, `${newName}.json`);
  await fs.rename(oldPath, newPath).catch(() => {});
}
