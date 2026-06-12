/**
 * LLMContextManager — single entry point for ALL operations on LLM conversation history.
 *
 * Owns LLMContext internally. Provides mutation methods, streaming state,
 * and an observable onChange mechanism. Does NOT handle statuses (UI concern)
 * or persistence (see SessionPersistence).
 *
 * Every consumer that needs to read or modify the conversation turns
 * goes through this class.
 */
import type {
  MessageParam,
  TextBlock,
  ThinkingBlock,
  ContentBlock,
  DisplayMessage,
} from "./messages.js";
import { toDisplayMessages } from "./messages.js";
import { LLMContext } from "./llm-context.js";

export class LLMContextManager {
  private ctx = new LLMContext();
  private listeners = new Set<() => void>();
  private streaming = false;

  // ── Observable ──────────────────────────────────────────

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  /** Subscribe to changes. Returns unsubscribe function. */
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ── Read ────────────────────────────────────────────────

  getTurns(): MessageParam[] {
    return [...this.ctx.turns];
  }

  getTurnCount(): number {
    return this.ctx.turns.length;
  }

  /** Get API-format messages for LLM. */
  toLLMMessages(): MessageParam[] {
    return this.ctx.turns as MessageParam[];
  }

  /** Get the last block in the last assistant turn (if any). */
  getLastBlock(): ContentBlock | undefined {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return undefined;
    const blocks = last.content as ContentBlock[];
    return blocks[blocks.length - 1];
  }

  // ── Mutation ────────────────────────────────────────────

  addUserMessage(content: string, displayContent?: string): void {
    const msg: MessageParam = { role: "user", content } as MessageParam;
    if (displayContent !== undefined && displayContent !== content) {
      this.ctx.displayOverrides.set(this.ctx.turns.length, displayContent);
    }
    this.ctx.turns.push(msg);
    this.notify();
  }

  /** Start a new assistant turn (empty content array). */
  startAssistantTurn(): void {
    this.ctx.turns.push({ role: "assistant", content: [] });
    this.notify();
  }

  /** Append a block to the last (open) assistant turn. Creates the turn if needed. */
  appendToLastAssistantTurn(block: ContentBlock): void {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content)) {
      this.startAssistantTurn();
    }
    const content = this.ctx.turns[this.ctx.turns.length - 1]
      .content as ContentBlock[];
    content.push(block);
    this.notify();
  }

  /** Update the text/thinking content of the last block in the last assistant turn. */
  updateLastBlock(updates: { text?: string; thinking?: string }): void {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return;
    const blocks = last.content as ContentBlock[];
    if (blocks.length === 0) return;
    Object.assign(blocks[blocks.length - 1], updates);
    this.notify();
  }

  /** Add a user turn containing tool_result blocks. */
  addToolResults(results: Array<{ toolUseId: string; content: string }>): void {
    if (results.length === 0) return;
    const blocks = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolUseId,
      content: r.content,
    }));
    this.ctx.turns.push({ role: "user", content: blocks });
    this.notify();
  }

  /** Replace all turns (for session resume / compression). */
  setTurns(turns: MessageParam[]): void {
    this.ctx.turns = turns;
    this.ctx.displayOverrides.clear();
    this.notify();
  }

  /** Remove the last turn if it matches the predicate. Returns true if removed. */
  removeLastTurn(predicate: (turn: MessageParam) => boolean): boolean {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (last && predicate(last)) {
      const idx = this.ctx.turns.length - 1;
      this.ctx.turns.pop();
      this.ctx.displayOverrides.delete(idx);
      this.notify();
      return true;
    }
    return false;
  }

  /** Clear all turns and display overrides. */
  clear(): void {
    this.ctx.turns = [];
    this.ctx.displayOverrides.clear();
    this.notify();
  }

  // ── Streaming state ─────────────────────────────────────

  setStreaming(v: boolean): void {
    if (this.streaming !== v) {
      this.streaming = v;
      this.notify();
    }
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  // ── Display ─────────────────────────────────────────────

  /**
   * Convenience: generate display messages from current state.
   * Callers that also have statuses should use the standalone
   * toDisplayMessages() function and pass statuses separately.
   */
  toDisplayMessages(statuses: import("./messages.js").StatusMessage[] = []): DisplayMessage[] {
    const msgs = toDisplayMessages(
      this.ctx.turns,
      statuses,
      this.ctx.displayOverrides,
    );
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
}
