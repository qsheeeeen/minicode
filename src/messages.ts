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
  | 'tool_call' | 'tool_result'
  | 'status' | 'error';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  timestamp: Date;
  inContext: boolean;       // Whether sent to LLM
  toolUseId?: string;       // Links tool_call ↔ tool_result
  toolName?: string;
  toolInput?: Record<string, unknown>;
  element?: React.ReactElement;
  isStreaming?: boolean;
}

// Map AgentMessageRole to DisplayMessageRole for TUI
function toDisplayRole(role: AgentMessageRole): DisplayMessageRole {
  switch (role) {
    case 'tool_call': return 'tool';
    case 'status': return 'system';
    default: return role;
  }
}

// Derive Anthropic MessageParam[] from AgentMessage[]
export function toLLMMessages(messages: AgentMessage[]): MessageParam[] {
  const result: MessageParam[] = [];
  const inContext = messages.filter(m => m.inContext);

  let i = 0;
  while (i < inContext.length) {
    const msg = inContext[i];

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
      i++;
    } else if (msg.role === 'assistant') {
      const contentBlocks: any[] = [];
      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }
      i++;
      // Gather tool_calls into this assistant turn
      while (i < inContext.length && inContext[i].role === 'tool_call') {
        const tc = inContext[i];
        contentBlocks.push({ type: 'tool_use', id: tc.toolUseId, name: tc.toolName, input: tc.toolInput ?? {} });
        i++;
      }
      result.push({ role: 'assistant', content: contentBlocks });

      // Gather tool_results into one user message
      const toolResults: any[] = [];
      while (i < inContext.length && inContext[i].role === 'tool_result') {
        const tr = inContext[i];
        toolResults.push({ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content });
        i++;
      }
      if (toolResults.length > 0) {
        result.push({ role: 'user', content: toolResults });
      }
    } else {
      i++;
    }
  }

  return result;
}

export function toDisplayMessages(messages: AgentMessage[]): import('./utils/session-display.js').DisplayMessage[] {
  return messages.map(msg => ({
    role: toDisplayRole(msg.role),
    content: msg.content,
    timestamp: msg.timestamp,
    isStreaming: msg.isStreaming,
    element: msg.element,
    slotId: msg.role === 'tool_call' ? msg.id : undefined,
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
            if (block.type === 'text') {
              store.add({ role: 'assistant', content: block.text, timestamp: new Date(), inContext: true });
            } else if (block.type === 'tool_use') {
              store.add({ role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: block.id, toolName: block.name, toolInput: block.input });
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
