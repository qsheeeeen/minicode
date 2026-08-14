import fs from "fs/promises";
import path from "path";

export interface ChangeRange {
  start: number;
  oldText: string;
  newText: string;
}

export interface ChangeEntry {
  userMessageOrdinal: number;
  path: string;
  op: "edit" | "write";
  beforeExists: boolean;
  ranges: ChangeRange[];
  ts: number;
}

export class ChangeJournal {
  private filePath = "";
  private entries: ChangeEntry[] = [];

  async startSession(sessionDir: string, sessionName: string): Promise<void> {
    this.close();
    await fs.mkdir(sessionDir, { recursive: true });
    this.filePath = path.join(sessionDir, `${sessionName}.changes.jsonl`);
    this.entries = await this.loadEntries();
  }

  async recordChange(
    userMessageOrdinal: number,
    filePath: string,
    op: "edit" | "write",
    beforeExists: boolean,
    ranges: readonly ChangeRange[],
  ): Promise<void> {
    if (!this.filePath) return;
    const entry: ChangeEntry = {
      userMessageOrdinal,
      path: filePath,
      op,
      beforeExists,
      ranges: ranges.map((range) => ({ ...range })),
      ts: Date.now(),
    };
    this.entries.push(entry);
    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async getEntries(): Promise<ChangeEntry[]> {
    return this.entries.map((entry) => ({
      ...entry,
      ranges: entry.ranges.map((range) => ({ ...range })),
    }));
  }

  async getEntriesByUserMessage(): Promise<Map<number, ChangeEntry[]>> {
    const entries = await this.getEntries();
    const map = new Map<number, ChangeEntry[]>();
    for (const e of entries) {
      const list = map.get(e.userMessageOrdinal) ?? [];
      list.push(e);
      map.set(e.userMessageOrdinal, list);
    }
    return map;
  }

  async pruneFromUserMessage(userMessageOrdinal: number): Promise<void> {
    const kept = this.entries.filter(
      (e) => e.userMessageOrdinal < userMessageOrdinal,
    );
    await this.writeFile(kept);
    this.entries = kept;
  }

  async pruneAndRenumberUserMessages(
    prunedCount: number,
    offsetAdded: number,
  ): Promise<void> {
    const kept = this.entries
      .filter((e) => e.userMessageOrdinal > prunedCount)
      .map((e) => ({
        ...e,
        userMessageOrdinal: e.userMessageOrdinal - prunedCount + offsetAdded,
      }));
    await this.writeFile(kept);
    this.entries = kept;
  }

  close(): void {}

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
    const tmpPath = this.filePath + ".tmp";
    const lines = entries.map((e) => JSON.stringify(e));
    await fs.writeFile(tmpPath, lines.join("\n") + (lines.length ? "\n" : ""));
    await fs.rename(tmpPath, this.filePath);
  }
}
