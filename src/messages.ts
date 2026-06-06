import type {
  MessageParam,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

// -- Session types --

interface SessionHeader {
  model: string;
  totalTokens: number;
  msgCount: number;
}

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

// UI-only status / error messages — not sent to LLM
export interface StatusMessage {
  role: "status" | "error";
  content: string;
  timestamp: Date;
  turnIndex?: number;
  element?: unknown;
  toolDisplay?: { name: string; input: Record<string, unknown>; output?: string };
}

// Display layer — each role carries only the fields it needs
export type MessageRole =
  | "user"
  | "text"
  | "thinking"
  | "tool"
  | "status"
  | "error";

export type DisplayMessage =
  | { role: "user"; content: string }
  | { role: "text"; content: string; isStreaming?: boolean }
  | { role: "thinking"; content: string; isStreaming?: boolean }
  | {
      role: "tool";
      name: string;
      input: Record<string, unknown>;
      output?: string;
      slotId: string;
    }
  | {
      role: "status";
      content: string;
      element?: unknown;
      toolDisplay?: { name: string; input: Record<string, unknown>; output?: string };
      timestamp?: Date;
    }
  | { role: "error"; content: string; timestamp?: Date };

// Convert MessageParam[] + statuses → DisplayMessage[]
export function toDisplayMessages(
  turns: MessageParam[],
  statuses: StatusMessage[],
  displayOverrides?: Map<number, string>,
): DisplayMessage[] {
  // Build result map from tool_result blocks
  const results = new Map<string, string>();
  for (const turn of turns) {
    if (turn.role === "user" && Array.isArray(turn.content)) {
      for (const block of turn.content) {
        if (block.type === "tool_result") {
          results.set(
            block.tool_use_id,
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
          );
        }
      }
    }
  }

  // Index statuses by turnIndex for chronological interleaving
  const byTurnIndex = new Map<number, StatusMessage[]>();
  for (const s of statuses) {
    const idx = s.turnIndex ?? turns.length;
    if (!byTurnIndex.has(idx)) byTurnIndex.set(idx, []);
    byTurnIndex.get(idx)!.push(s);
  }

  const result: DisplayMessage[] = [];

  // Statuses with turnIndex 0 come before all turns
  for (const s of byTurnIndex.get(0) ?? []) {
    result.push({
      role: s.role,
      content: s.content,
      element: s.element,
      toolDisplay: s.toolDisplay,
      timestamp: s.timestamp,
    });
  }

  // Single pass: process turns, interleaving statuses after each
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role === "user") {
      if (typeof turn.content === "string") {
        const displayContent =
          displayOverrides?.get(i) ?? turn.content;
        result.push({ role: "user", content: displayContent });
      }
    } else if (turn.role === "assistant") {
      const blocks = Array.isArray(turn.content) ? turn.content : [];
      for (const block of blocks as ContentBlock[]) {
        if (block.type === "thinking") {
          result.push({ role: "thinking", content: block.thinking });
        } else if (block.type === "text") {
          result.push({ role: "text", content: block.text });
        } else if (block.type === "tool_use") {
          result.push({
            role: "tool",
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
            output: results.get(block.id),
            slotId: block.id,
          });
        }
      }
    }
    // Statuses added after this turn
    for (const s of byTurnIndex.get(i + 1) ?? []) {
      result.push({
        role: s.role,
        content: s.content,
        element: s.element,
      toolDisplay: s.toolDisplay,
        timestamp: s.timestamp,
      });
    }
  }

  // Any unmatched statuses (turnIndex > turns.length) go at the end
  for (const s of statuses) {
    if (s.turnIndex !== undefined && s.turnIndex > turns.length) {
      result.push({
        role: s.role,
        content: s.content,
        element: s.element,
      toolDisplay: s.toolDisplay,
        timestamp: s.timestamp,
      });
    }
  }

  return result;
}

export class MessageStore {
  private turns: MessageParam[] = [];
  private displayOverrides = new Map<number, string>();
  private statuses: StatusMessage[] = [];
  private listeners = new Set<() => void>();
  private streaming = false;

  // -- Streaming state (for TUI cursor animation) --

  setStreaming(v: boolean): void {
    if (this.streaming !== v) {
      this.streaming = v;
      this.notify();
    }
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  // Subscribe to updates. Returns an unsubscribe function.
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  getTurns(): MessageParam[] {
    return [...this.turns];
  }

  /** Remove the last turn if it matches the predicate. Returns true if removed. */
  removeLastTurn(predicate: (turn: MessageParam) => boolean): boolean {
    const last = this.turns[this.turns.length - 1];
    if (last && predicate(last)) {
      const idx = this.turns.length - 1;
      this.turns.pop();
      this.displayOverrides.delete(idx);
      this.notify();
      return true;
    }
    return false;
  }

  /** Replace all turns (for session resume / compression). */
  setTurns(turns: MessageParam[]): void {
    this.turns = turns;
    this.displayOverrides.clear();
    this.notify();
  }

  /** Get API-format messages for LLM. */
  toLLMMessages(): MessageParam[] {
    return this.turns as MessageParam[];
  }

  // -- User messages --

  addUserMessage(content: string, displayContent?: string): void {
    const msg: MessageParam = { role: "user", content } as MessageParam;
    if (displayContent !== undefined && displayContent !== content) {
      this.displayOverrides.set(this.turns.length, displayContent);
    }
    this.turns.push(msg);
    this.notify();
  }

  // -- Streaming: building assistant turns incrementally --

  /** Start a new assistant turn (empty content array). */
  startAssistantTurn(): void {
    this.turns.push({ role: "assistant", content: [] });
    this.notify();
  }

  /** Append a block to the last (open) assistant turn. Creates the turn if needed. */
  appendToLastAssistantTurn(block: ContentBlock): void {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content)) {
      this.startAssistantTurn();
    }
    const content = this.turns[this.turns.length - 1].content as ContentBlock[];
    content.push(block);
    this.notify();
  }

  /** Get the last block in the last assistant turn (if any). */
  getLastBlock(): ContentBlock | undefined {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return undefined;
    const blocks = last.content as ContentBlock[];
    return blocks[blocks.length - 1];
  }

  /** Update the text/thinking content of the last block in the last assistant turn. */
  updateLastBlock(updates: { text?: string; thinking?: string }): void {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return;
    const blocks = last.content as any[];
    if (blocks.length === 0) return;
    Object.assign(blocks[blocks.length - 1], updates);
    this.notify();
  }

  // -- Tool results --

  /** Add a user turn containing tool_result blocks. */
  addToolResults(results: Array<{ toolUseId: string; content: string }>): void {
    if (results.length === 0) return;
    const blocks = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolUseId,
      content: r.content,
    }));
    this.turns.push({ role: "user", content: blocks });
    this.notify();
  }

  // -- Status / error messages --

  addStatus(msg: StatusMessage): void {
    msg.turnIndex = this.turns.length;
    this.statuses.push(msg);
    this.notify();
  }

  getStatuses(): StatusMessage[] {
    return this.statuses;
  }

  /** Convenience: generate display messages from current state. */
  toDisplayMessages(): DisplayMessage[] {
    const msgs = toDisplayMessages(this.turns, this.statuses, this.displayOverrides);
    // Mark last non-empty text/thinking block as streaming
    if (this.streaming) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if ((m.role === "text" || m.role === "thinking") && m.content) {
          m.isStreaming = true;
          break;
        }
      }
    }
    return msgs;
  }

  // -- Lifecycle --

  clear(): void {
    this.turns = [];
    this.displayOverrides.clear();
    this.statuses = [];
    this.notify();
  }

  replace(turns: MessageParam[]): void {
    this.turns = turns;
    this.statuses = [];
    this.notify();
  }

  // -- Session persistence --

  private sessionName = "";
  private meta = { model: "unknown", totalTokens: 0 };

  private static readonly BASE_DIR = path.join(
    os.homedir(),
    ".minicode",
    "sessions",
  );
  private static readonly EXT = ".context.jsonl";

  setSessionName(name: string): void {
    this.sessionName = name;
  }

  getSessionName(): string {
    return this.sessionName;
  }

  setMeta(meta: { model?: string; totalTokens?: number }): void {
    if (meta.model !== undefined) this.meta.model = meta.model;
    if (meta.totalTokens !== undefined) this.meta.totalTokens = meta.totalTokens;
  }

  getMeta(): { model: string; totalTokens: number } {
    return { ...this.meta };
  }

  async save(): Promise<void> {
    if (!this.sessionName) return;
    const dir = MessageStore.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${this.sessionName}${MessageStore.EXT}`);
    const tmpPath = filePath + ".tmp";
    const header: SessionHeader = {
      model: this.meta.model,
      totalTokens: this.meta.totalTokens,
      msgCount: this.turns.length,
    };
    const lines = [JSON.stringify(header)];
    for (const msg of this.toLLMMessages()) {
      lines.push(JSON.stringify(msg));
    }
    await fs.writeFile(tmpPath, lines.join("\n") + "\n");
    await fs.rename(tmpPath, filePath);
  }

  static async load(
    name: string,
  ): Promise<SessionData | null> {
    const dir = MessageStore.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}${MessageStore.EXT}`);
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

  static getProjectHash(): string {
    return crypto
      .createHash("md5")
      .update(process.cwd())
      .digest("hex")
      .substring(0, 12);
  }

  static getSessionDir(): string {
    return path.join(MessageStore.BASE_DIR, MessageStore.getProjectHash());
  }

  static async list(): Promise<SessionInfo[]> {
    const dir = MessageStore.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir).catch(() => []);
    const sessions: SessionInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(MessageStore.EXT)) continue;
      const name = entry.replace(MessageStore.EXT, "");
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
    const dir = MessageStore.getSessionDir();
    const paths = [
      path.join(dir, `${name}${MessageStore.EXT}`),
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
    const dir = MessageStore.getSessionDir();
    await fs.mkdir(dir, { recursive: true });
    const oldPath = path.join(dir, `${oldName}${MessageStore.EXT}`);
    const newPath = path.join(dir, `${newName}${MessageStore.EXT}`);
    await fs.rename(oldPath, newPath).catch(() => {});
  }

  static async getMostRecent(): Promise<string | null> {
    const sessions = await MessageStore.list();
    return sessions.length > 0 ? sessions[0].name : null;
  }
}
