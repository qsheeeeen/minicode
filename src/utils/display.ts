/**
 * Display adapter for TUI/Console output.
 * Split into StreamDisplay, NotificationDisplay, StateDisplay.
 */

import React from 'react';
import type { DisplayMessage } from './session-display.js';

export type { DisplayMessage };

type DisplayCallback = {
  onMessage?: (msg: DisplayMessage) => void;
  onMessageUpdate?: (id: string, updater: (msg: DisplayMessage) => DisplayMessage) => void;
  onStatusUpdate?: (status: string) => void;
  onTokenUpdate?: (tokens: number) => void;
};

// Stream lifecycle: start → chunk* → end
export interface StreamDisplay {
  streamStart(messageId: string): void;
  streamChunk(messageId: string, chunk: string): void;
  streamEnd(messageId: string): void;
  streamThinkingStart(messageId: string): void;
  streamThinkingChunk(messageId: string, chunk: string): void;
  streamThinkingEnd(messageId: string): void;
}

// Ephemeral messages
export interface NotificationDisplay {
  status(msg: string): void;
  error(msg: string): void;
  progress(msg: string): void;
  raw(text: string): void;
}

// State updates
export interface StateDisplay {
  updateTokenCount(tokens: number): void;
  clear(): void;
}

export type DisplayAdapter = StreamDisplay & NotificationDisplay & StateDisplay;

// Console fallback
export class ConsoleDisplay implements DisplayAdapter {
  private buffer: string = '';

  status(msg: string): void { console.log(`[Status] ${msg}`); }
  raw(text: string): void { console.log(text); }
  error(msg: string): void { console.log(`[Error] ${msg}`); }
  progress(msg: string): void { process.stdout.write(`... ${msg}`); }

  streamStart(_messageId: string): void { this.buffer = ''; }
  streamChunk(_messageId: string, chunk: string): void { this.buffer += chunk; process.stdout.write(chunk); }
  streamEnd(_messageId: string): void { if (this.buffer && !this.buffer.endsWith('\n')) console.log(); this.buffer = ''; }
  streamThinkingStart(_messageId: string): void { process.stdout.write('\x1b[2m'); }
  streamThinkingChunk(_messageId: string, chunk: string): void { process.stdout.write(chunk); }
  streamThinkingEnd(_messageId: string): void { process.stdout.write('\x1b[0m\n'); }

  updateTokenCount(_tokens: number): void {}
  clear(): void {}
}

// Callback-based adapter for ink TUI
export class CallbackDisplay implements DisplayAdapter {
  constructor(private callbacks: DisplayCallback) {}

  status(msg: string): void {
    this.callbacks.onMessage?.({ role: 'status', content: msg, timestamp: new Date() });
  }

  error(msg: string): void {
    this.callbacks.onMessage?.({ role: 'error', content: msg, timestamp: new Date() });
  }

  raw(text: string): void {
    this.callbacks.onMessage?.({ role: 'assistant', content: text, timestamp: new Date() });
  }

  progress(msg: string): void {
    this.callbacks.onStatusUpdate?.(msg);
  }

  streamStart(messageId: string): void {
    this.callbacks.onMessage?.({ role: 'assistant', content: '', timestamp: new Date(), isStreaming: true, slotId: messageId });
  }

  streamChunk(messageId: string, chunk: string): void {
    this.callbacks.onMessageUpdate?.(messageId, prev => ({ ...prev, content: prev.content + chunk }));
  }

  streamEnd(messageId: string): void {
    this.callbacks.onMessageUpdate?.(messageId, prev => ({ ...prev, isStreaming: false }));
  }

  streamThinkingStart(messageId: string): void {
    this.callbacks.onMessage?.({ role: 'thinking', content: '', timestamp: new Date(), isStreaming: true, slotId: messageId });
  }

  streamThinkingChunk(messageId: string, chunk: string): void {
    this.callbacks.onMessageUpdate?.(messageId, prev => ({ ...prev, content: prev.content + chunk }));
  }

  streamThinkingEnd(messageId: string): void {
    this.callbacks.onMessageUpdate?.(messageId, prev => ({ ...prev, isStreaming: false }));
  }

  updateTokenCount(tokens: number): void { this.callbacks.onTokenUpdate?.(tokens); }
  clear(): void {}
}
