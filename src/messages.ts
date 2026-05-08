import type { MessageParam, ContentBlock } from './llm/anthropic.js';

export interface ToolDisplayResult {
  content: string;
  element?: React.ReactElement;
}

export type ToolDisplayFormatter = (
  toolName: string,
  input: Record<string, unknown>,
  output?: string,
) => ToolDisplayResult;

// UI-only status / error messages — not sent to LLM
export interface StatusMessage {
  role: 'status' | 'error';
  content: string;
  timestamp: Date;
  turnIndex?: number;
  element?: React.ReactElement;
}

// Display layer uses these fields
export type MessageRole = 'user' | 'text' | 'thinking' | 'tool' | 'status' | 'error';
export interface DisplayMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
  element?: React.ReactElement;
  slotId?: string;
}

// Convert MessageParam[] + statuses → DisplayMessage[]
export function toDisplayMessages(
  turns: MessageParam[],
  statuses: StatusMessage[],
  formatDisplay: ToolDisplayFormatter,
): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  const toolUseMsgs = new Map<string, DisplayMessage>();
  const toolUseData = new Map<string, { name: string; input: Record<string, unknown> }>();

  // Index statuses by turnIndex for chronological interleaving
  const byTurnIndex = new Map<number, StatusMessage[]>();
  for (const s of statuses) {
    const idx = s.turnIndex ?? turns.length;
    if (!byTurnIndex.has(idx)) byTurnIndex.set(idx, []);
    byTurnIndex.get(idx)!.push(s);
  }

  // Statuses with turnIndex 0 come before all turns
  for (const s of byTurnIndex.get(0) ?? []) {
    result.push({ role: s.role, content: s.content, element: s.element, timestamp: s.timestamp });
  }

  // Pass 1: process turns, interleaving statuses after each
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role === 'user') {
      if (typeof turn.content === 'string') {
        const displayContent = (turn as any)._display !== undefined ? (turn as any)._display : turn.content;
        result.push({ role: 'user', content: displayContent });
      }
    } else if (turn.role === 'assistant') {
      const blocks = Array.isArray(turn.content) ? turn.content : [];
      for (const block of blocks as ContentBlock[]) {
        if (block.type === 'thinking') {
          result.push({ role: 'thinking', content: block.thinking });
        } else if (block.type === 'text') {
          result.push({ role: 'text', content: block.text });
        } else if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;
          const display = formatDisplay(block.name, input);
          const dm: DisplayMessage = { role: 'tool', content: display.content, element: display.element, slotId: block.id };
          result.push(dm);
          toolUseMsgs.set(block.id, dm);
          toolUseData.set(block.id, { name: block.name, input });
        }
      }
    }
    // Statuses added after this turn
    for (const s of byTurnIndex.get(i + 1) ?? []) {
      result.push({ role: s.role, content: s.content, element: s.element, timestamp: s.timestamp });
    }
  }

  // Pass 2: attach tool_result content to matching tool_use display elements
  for (const turn of turns) {
    if (turn.role === 'user' && Array.isArray(turn.content)) {
      for (const block of turn.content as any[]) {
        if (block.type === 'tool_result') {
          const dm = toolUseMsgs.get(block.tool_use_id);
          const td = toolUseData.get(block.tool_use_id);
          if (dm && td) {
            const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            const display = formatDisplay(td.name, td.input, raw);
            dm.content = display.content;
            dm.element = display.element;
          }
        }
      }
    }
  }

  // Any unmatched statuses (turnIndex > turns.length) go at the end
  for (const s of statuses) {
    if (s.turnIndex !== undefined && s.turnIndex > turns.length) {
      result.push({ role: s.role, content: s.content, element: s.element, timestamp: s.timestamp });
    }
  }

  return result;
}

export class MessageStore {
  private turns: MessageParam[] = [];
  private statuses: StatusMessage[] = [];
  private changeCallback?: () => void;
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

  onChange(callback: () => void): void {
    this.changeCallback = callback;
  }

  private notify(): void {
    this.changeCallback?.();
  }

  // -- Turn access --

  getTurns(): MessageParam[] {
    return this.turns;
  }

  /** Replace all turns (for session resume). */
  setTurns(turns: MessageParam[]): void {
    this.turns = turns;
    this.notify();
  }

  /** Get API-format messages for LLM. Strips display-only metadata. */
  toLLMMessages(): MessageParam[] {
    return this.turns.map(t => {
      const msg = t as any;
      if (msg._display !== undefined) {
        const { _display, ...rest } = msg;
        return rest as MessageParam;
      }
      return t;
    });
  }

  // -- User messages --

  addUserMessage(content: string, displayContent?: string): void {
    const msg: MessageParam = { role: 'user', content } as MessageParam;
    if (displayContent !== undefined && displayContent !== content) {
      (msg as any)._display = displayContent;
    }
    this.turns.push(msg);
    this.notify();
  }

  // -- Streaming: building assistant turns incrementally --

  /** Start a new assistant turn (empty content array). */
  startAssistantTurn(): void {
    this.turns.push({ role: 'assistant', content: [] });
    this.notify();
  }

  /** Append a block to the last (open) assistant turn. Creates the turn if needed. */
  appendToLastAssistantTurn(block: ContentBlock): void {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) {
      this.startAssistantTurn();
    }
    const content = this.turns[this.turns.length - 1].content as ContentBlock[];
    content.push(block);
    this.notify();
  }

  /** Get the last block in the last assistant turn (if any). */
  getLastBlock(): ContentBlock | undefined {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return undefined;
    const blocks = last.content as ContentBlock[];
    return blocks[blocks.length - 1];
  }

  /** Update the text/thinking content of the last block in the last assistant turn. */
  updateLastBlock(updates: { text?: string; thinking?: string }): void {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return;
    const blocks = last.content as any[];
    if (blocks.length === 0) return;
    Object.assign(blocks[blocks.length - 1], updates);
    this.notify();
  }

  // -- Tool results --

  /** Add a user turn containing tool_result blocks. */
  addToolResults(results: Array<{ toolUseId: string; content: string }>): void {
    if (results.length === 0) return;
    const blocks = results.map(r => ({
      type: 'tool_result' as const,
      tool_use_id: r.toolUseId,
      content: r.content,
    }));
    this.turns.push({ role: 'user', content: blocks });
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
  toDisplayMessages(formatDisplay: ToolDisplayFormatter): DisplayMessage[] {
    const msgs = toDisplayMessages(this.turns, this.statuses, formatDisplay);
    // Mark last non-empty text/thinking block as streaming
    if (this.streaming) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i].role === 'text' || msgs[i].role === 'thinking') && msgs[i].content) {
          msgs[i].isStreaming = true;
          break;
        }
      }
    }
    return msgs;
  }

  // -- Lifecycle --

  clear(): void {
    this.turns = [];
    this.statuses = [];
    this.notify();
  }

  replace(turns: MessageParam[]): void {
    this.turns = turns;
    this.statuses = [];
    this.notify();
  }
}
