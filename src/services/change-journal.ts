import fs from "fs/promises";
import path from "path";

export interface ChangeRange {
  start: number;
  oldText: string;
  newText: string;
}

export interface ChangeEntry {
  /** Stable id of the user message this change belongs to (matches the
   *  user block's id in the conversation — survives truncation, forking,
   *  and compression without renumbering). */
  userMessageId: string;
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
    userMessageId: string | undefined,
    filePath: string,
    op: "edit" | "write",
    beforeExists: boolean,
    ranges: readonly ChangeRange[],
  ): Promise<void> {
    if (!this.filePath || !userMessageId) return;
    const entry: ChangeEntry = {
      userMessageId,
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

  async getEntriesByUserMessage(): Promise<Map<string, ChangeEntry[]>> {
    const entries = await this.getEntries();
    const map = new Map<string, ChangeEntry[]>();
    for (const e of entries) {
      const list = map.get(e.userMessageId) ?? [];
      list.push(e);
      map.set(e.userMessageId, list);
    }
    return map;
  }

  /** Drop every entry belonging to the given user messages (undo, abort,
   *  compression). Entries are keyed by id, so callers pass exactly the
   *  messages that disappeared. */
  async pruneByMessageIds(removeIds: ReadonlySet<string>): Promise<void> {
    if (removeIds.size === 0) return;
    const kept = this.entries.filter((e) => !removeIds.has(e.userMessageId));
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
          const parsed = JSON.parse(line) as ChangeEntry;
          // Legacy journals (pre-stable-id) keyed by ordinal — those ids
          // cannot map to the new scheme, so the undo history starts fresh.
          if (typeof parsed.userMessageId === "string" && parsed.userMessageId) {
            entries.push(parsed);
          }
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
