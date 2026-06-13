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
import type { ContextTurn, MessageParam } from "./turns.js";
import type { ContentBlock } from "./blocks.js";
import type { DisplayMessage, StatusMessage } from "./display.js";
import { groupMessagesIntoContextTurns } from "./turns.js";
import { toDisplayMessages } from "./transform.js";
import { LLMContext } from "./llm-context.js";

export class LLMContextManager {
  private ctx = new LLMContext();
  private listeners = new Set<() => void>();
  private streaming = false;

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getTurns(): MessageParam[] {
    return [...this.ctx.turns];
  }

  getTurnCount(): number {
    return this.ctx.turns.length;
  }

  getContextTurns(): ContextTurn[] {
    return groupMessagesIntoContextTurns(
      this.ctx.turns,
      this.ctx.displayOverrides,
    );
  }

  toLLMMessages(): MessageParam[] {
    return this.ctx.turns as MessageParam[];
  }

  getLastBlock(): ContentBlock | undefined {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return undefined;
    const blocks = last.content as ContentBlock[];
    return blocks[blocks.length - 1];
  }

  addUserMessage(content: string, displayContent?: string): void {
    const msg: MessageParam = { role: "user", content } as MessageParam;
    if (displayContent !== undefined && displayContent !== content) {
      this.ctx.displayOverrides.set(this.ctx.turns.length, displayContent);
    }
    this.ctx.turns.push(msg);
    this.notify();
  }

  startAssistantTurn(): void {
    this.ctx.turns.push({ role: "assistant", content: [] });
    this.notify();
  }

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

  updateLastBlock(updates: { text?: string; thinking?: string }): void {
    const last = this.ctx.turns[this.ctx.turns.length - 1];
    if (!last || last.role !== "assistant" || !Array.isArray(last.content))
      return;
    const blocks = last.content as ContentBlock[];
    if (blocks.length === 0) return;
    Object.assign(blocks[blocks.length - 1], updates);
    this.notify();
  }

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

  setTurns(turns: MessageParam[]): void {
    this.ctx.turns = turns;
    this.ctx.displayOverrides.clear();
    this.notify();
  }

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

  clear(): void {
    this.ctx.turns = [];
    this.ctx.displayOverrides.clear();
    this.notify();
  }

  setStreaming(v: boolean): void {
    if (this.streaming !== v) {
      this.streaming = v;
      this.notify();
    }
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  toDisplayMessages(statuses: StatusMessage[] = []): DisplayMessage[] {
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
