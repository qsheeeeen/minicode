import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

export interface ChangeEntry {
  turnIdx: number;
  path: string;
  op: "edit" | "write";
  before: string;
  ts: number;
}

export class ChangeJournal {
  private filePath = "";
  private writeStream: fsSync.WriteStream | null = null;
  private cache: ChangeEntry[] | null = null;

  async startSession(sessionDir: string, sessionName: string): Promise<void> {
    this.close();
    await fs.mkdir(sessionDir, { recursive: true });
    this.filePath = path.join(sessionDir, `${sessionName}.changes.jsonl`);
    this.cache = null;
    this.writeStream = fsSync.createWriteStream(this.filePath, {
      flags: "a",
      encoding: "utf-8",
    });
  }

  recordBefore(
    turnIdx: number,
    filePath: string,
    op: "edit" | "write",
    content: string,
  ): void {
    if (!this.writeStream) return;
    const entry: ChangeEntry = {
      turnIdx,
      path: filePath,
      op,
      before: content,
      ts: Date.now(),
    };
    this.writeStream.write(JSON.stringify(entry) + "\n");
    if (this.cache) this.cache.push(entry);
  }

  async getEntries(): Promise<ChangeEntry[]> {
    if (this.cache) return [...this.cache];
    this.cache = await this.loadEntries();
    return [...this.cache];
  }

  async getEntriesByTurn(): Promise<Map<number, ChangeEntry[]>> {
    const entries = await this.getEntries();
    const map = new Map<number, ChangeEntry[]>();
    for (const e of entries) {
      const list = map.get(e.turnIdx) ?? [];
      list.push(e);
      map.set(e.turnIdx, list);
    }
    return map;
  }

  async pruneFrom(turnIdx: number): Promise<void> {
    const entries = await this.loadEntries();
    const kept = entries.filter((e) => e.turnIdx < turnIdx);
    await this.writeFile(kept);
    this.cache = kept;
  }

  async pruneAndRenumber(prunedCount: number, offsetAdded: number): Promise<void> {
    const entries = await this.loadEntries();
    const kept = entries
      .filter((e) => e.turnIdx > prunedCount)
      .map((e) => ({ ...e, turnIdx: e.turnIdx - prunedCount + offsetAdded }));
    await this.writeFile(kept);
    this.cache = kept;
  }

  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  private async loadEntries(): Promise<ChangeEntry[]> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const entries: ChangeEntry[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as ChangeEntry);
        } catch {
          // Skip malformed lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  private async writeFile(entries: ChangeEntry[]): Promise<void> {
    if (!this.filePath) return;
    this.close();
    const tmpPath = this.filePath + ".tmp";
    const lines = entries.map((e) => JSON.stringify(e));
    await fs.writeFile(tmpPath, lines.join("\n") + (lines.length ? "\n" : ""));
    await fs.rename(tmpPath, this.filePath);
    this.writeStream = fsSync.createWriteStream(this.filePath, {
      flags: "a",
      encoding: "utf-8",
    });
  }
}
