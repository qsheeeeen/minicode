/**
 * Unified message model — single source of truth for both LLM context and TUI display.
 * AgentMessage[] is the canonical store. Two derived views:
 * - toLLMMessages() → Anthropic MessageParam[] for the API
 * - toDisplayMessages() → DisplayMessage[] for TUI rendering
 */

import React from 'react';
import type { MessageParam } from './llm/anthropic.js';
import type { MessageRole as DisplayMessageRole } from './utils/session-display.js';

export type AgentMessageRole =
  | 'user' | 'assistant' | 'thinking'
  | 'tool_use' | 'tool_result'
  | 'status' | 'error';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  displayContent?: string;
  timestamp: Date;
  inContext: boolean;       // Whether sent to LLM
  toolUseId?: string;       // Links tool_use ↔ tool_result
  toolName?: string;
  toolInput?: Record<string, unknown>;
  element?: React.ReactElement;
  isStreaming?: boolean;
}

// Map AgentMessageRole to DisplayMessageRole for TUI
function toDisplayRole(role: AgentMessageRole): DisplayMessageRole {
  switch (role) {
    case 'tool_use': return 'tool';
    case 'status': return 'status';
    default: return role;
  }
}

// Derive Anthropic MessageParam[] from AgentMessage[]
//
// The Anthropic API expects grouped turns:
//   assistant: [text_block, tool_use_block, ...]  → one turn
//   user:      [tool_result_block, ...]            → one turn
//
// The store keeps a flat list where assistant text, tool_use, and tool_result
// are separate AgentMessage entries.  This function groups them correctly.
//
// Algorithm: iterate inContext messages. For each group:
//   1. If 'user' string → emit directly.
//   2. If 'assistant' → consume it (text), then collect consecutive 'tool_use'.
//      If the first message is already 'tool_use' (LLM returned tool_use with
//      no text), skip the assistant-text step — the while-loop picks it up.
//   3. Collect consecutive 'tool_result' into one user turn.
//
// The critical detail: when the group starts with 'tool_use' (not 'assistant'),
// we do NOT advance i before the tool_use while-loop, so no message is skipped.

export function toLLMMessages(messages: AgentMessage[]): MessageParam[] {
  const result: MessageParam[] = [];
  const inContext = messages.filter(m => m.inContext);

  let i = 0;
  while (i < inContext.length) {
    const msg = inContext[i];

    // 1. Plain user text message
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
      i++;
      continue;
    }

    // 2. Assistant turn: optional text + tool_use blocks + thinking blocks
    const contentBlocks: any[] = [];

    // Consume assistant text or thinking if present (may be absent when LLM returns
    // only tool_use blocks — in that case msg is 'tool_use' and we skip this)
    if (msg.role === 'assistant') {
      if (msg.content) contentBlocks.push({ type: 'text', text: msg.content });
      i++;
      // fall through to collect tool_uses from new position
    } else if (msg.role === 'thinking') {
      contentBlocks.push({ type: 'thinking', thinking: msg.content });
      i++;
      // fall through to collect tool_uses from new position
    }

    // Collect consecutive tool_uses.
    // If group started with tool_use (no assistant text), i still points
    // to it, so the loop naturally picks up the first one — no special case.
    while (i < inContext.length && inContext[i].role === 'tool_use') {
      const tc = inContext[i];
      contentBlocks.push({ type: 'tool_use', id: tc.toolUseId, name: tc.toolName, input: tc.toolInput ?? {} });
      i++;
    }

    if (contentBlocks.length > 0) {
      result.push({ role: 'assistant', content: contentBlocks });
    }

    // 3. Tool results → one user turn
    const toolResults: any[] = [];
    while (i < inContext.length && inContext[i].role === 'tool_result') {
      const tr = inContext[i];
      toolResults.push({ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content });
      i++;
    }
    if (toolResults.length > 0) {
      result.push({ role: 'user', content: toolResults });
    }
  }

  return result;
}

export function toDisplayMessages(messages: AgentMessage[]): import('./utils/session-display.js').DisplayMessage[] {
  return messages.map(msg => ({
    role: toDisplayRole(msg.role),
    content: msg.displayContent ?? msg.content,
    timestamp: msg.timestamp,
    isStreaming: msg.isStreaming,
    element: msg.element,
    slotId: msg.role === 'tool_use' ? msg.id : undefined,
  }));
}

export class MessageStore {
  private messages: AgentMessage[] = [];
  private nextId = 0;
  private changeCallback?: () => void;

  onChange(callback: () => void): void {
    this.changeCallback = callback;
  }

  private notifyChange(): void {
    this.changeCallback?.();
  }

  add(msg: Omit<AgentMessage, 'id'>): AgentMessage {
    const full: AgentMessage = { ...msg, id: `msg-${this.nextId++}` };
    this.messages.push(full);
    this.notifyChange();
    return full;
  }

  update(id: string, patch: Partial<AgentMessage>): void {
    const idx = this.messages.findIndex(m => m.id === id);
    if (idx !== -1) {
      this.messages[idx] = { ...this.messages[idx], ...patch };
      this.notifyChange();
    }
  }

  get(id: string): AgentMessage | undefined {
    return this.messages.find(m => m.id === id);
  }

  getAll(): AgentMessage[] {
    return this.messages;
  }

  getInContext(): AgentMessage[] {
    return this.messages.filter(m => m.inContext);
  }

  toLLMMessages(): MessageParam[] {
    return toLLMMessages(this.messages);
  }

  toDisplayMessages(): import('./utils/session-display.js').DisplayMessage[] {
    return toDisplayMessages(this.messages);
  }

  clear(): void {
    this.messages = [];
    this.nextId = 0;
    this.notifyChange();
  }

  replace(messages: AgentMessage[]): void {
    this.messages = messages;
    this.notifyChange();
  }

  static fromMessageParams(params: MessageParam[]): MessageStore {
    const store = new MessageStore();
    for (const param of params) {
      if (param.role === 'user') {
        if (typeof param.content === 'string') {
          store.add({ role: 'user', content: param.content, timestamp: new Date(), inContext: true });
        }
      } else if (param.role === 'assistant') {
        if (typeof param.content === 'string') {
          store.add({ role: 'assistant', content: param.content, timestamp: new Date(), inContext: true });
        } else if (Array.isArray(param.content)) {
          for (const block of param.content as any[]) {
            if (block.type === 'thinking') {
              store.add({ role: 'thinking', content: block.thinking, timestamp: new Date(), inContext: true });
            } else if (block.type === 'text') {
              store.add({ role: 'assistant', content: block.text, timestamp: new Date(), inContext: true });
            } else if (block.type === 'tool_use') {
              store.add({ role: 'tool_use', content: '', timestamp: new Date(), inContext: true, toolUseId: block.id, toolName: block.name, toolInput: block.input });
            }
          }
        }
      }
    }
    // tool_result blocks from user messages with array content
    for (const param of params) {
      if (param.role === 'user' && Array.isArray(param.content)) {
        for (const block of param.content as any[]) {
          if (block.type === 'tool_result') {
            const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            store.add({ role: 'tool_result', content: raw, timestamp: new Date(), inContext: true, toolUseId: block.tool_use_id });
          }
        }
      }
    }
    return store;
  }
}
