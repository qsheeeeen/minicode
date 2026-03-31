/**
 * Display adapter for TUI/Console output
 * Provides an abstraction layer for different display modes
 */

import React from 'react';
import type { MessageRole, DisplayMessage } from './session-display.js';

// Re-export for convenience
export type { MessageRole, DisplayMessage };

export type DisplayCallback = {
  onMessage?: (msg: DisplayMessage) => void;
  onUpdateLast?: (updater: (msg: DisplayMessage) => DisplayMessage) => void;
  onStatusUpdate?: (status: string) => void;
  onTokenUpdate?: (tokens: number) => void;
};

export interface DisplayAdapter {
  /** Display a system message */
  system(msg: string): void;

  /** Display a tool call */
  toolCall(msg: string): void;

  /** Display a tool result */
  toolResult(msg: string, element?: React.ReactElement): void;

  /** Display an error */
  error(msg: string): void;

  /** Display progress (no newline) */
  progress(msg: string): void;

  /** Display raw text */
  raw(text: string): void;

  /** Start streaming a response */
  streamStart(): void;

  /** Stream a chunk of text */
  streamChunk(chunk: string): void;

  /** End streaming */
  streamEnd(): void;

  /** Start streaming thinking content */
  streamThinkingStart(): void;

  /** Stream a chunk of thinking text */
  streamThinkingChunk(chunk: string): void;

  /** End streaming thinking */
  streamThinkingEnd(): void;

  /** Update token count display */
  updateTokenCount?(tokens: number): void;

  /** Clear display */
  clear?(): void;
}

/**
 * Console-based display adapter (fallback for development/debugging)
 */
export class ConsoleDisplay implements DisplayAdapter {
  private buffer: string = '';

  system(msg: string): void {
    console.log(`[System] ${msg}`);
  }

  toolCall(msg: string): void {
    console.log(`[Tool] ${msg}`);
  }

  toolResult(msg: string, element?: React.ReactElement): void {
    console.log(`${msg}`);
  }

  error(msg: string): void {
    console.log(`[Error] ${msg}`);
  }

  progress(msg: string): void {
    process.stdout.write(`... ${msg}`);
  }

  raw(text: string): void {
    console.log(text);
  }

  streamStart(): void {
    this.buffer = '';
  }

  streamChunk(chunk: string): void {
    this.buffer += chunk;
    process.stdout.write(chunk);
  }

  streamEnd(): void {
    if (this.buffer && !this.buffer.endsWith('\n')) {
      console.log();
    }
    this.buffer = '';
  }

  streamThinkingStart(): void {
    process.stdout.write('\x1b[2m');
  }

  streamThinkingChunk(chunk: string): void {
    process.stdout.write(chunk);
  }

  streamThinkingEnd(): void {
    process.stdout.write('\x1b[0m\n');
  }
}

/**
 * Callback-based display adapter for ink TUI
 */
export class CallbackDisplay implements DisplayAdapter {
  constructor(private callbacks: DisplayCallback) {}

  system(msg: string): void {
    this.callbacks.onMessage?.({ role: 'system', content: msg, timestamp: new Date() });
  }

  toolCall(msg: string): void {
    // Show tool call as a message so user sees what's being executed
    this.callbacks.onMessage?.({ role: 'tool', content: msg, timestamp: new Date() });
  }

  toolResult(msg: string, element?: React.ReactElement): void {
    // Show tool results as output
    this.callbacks.onMessage?.({ role: 'tool_result', content: msg, timestamp: new Date(), element });
  }

  error(msg: string): void {
    this.callbacks.onMessage?.({ role: 'error', content: msg, timestamp: new Date() });
  }

  progress(msg: string): void {
    this.callbacks.onStatusUpdate?.(msg);
  }

  raw(text: string): void {
    // Raw output - show as assistant message (for direct mode compatibility)
    this.callbacks.onMessage?.({ role: 'assistant', content: text, timestamp: new Date() });
  }

  streamStart(): void {
    this.callbacks.onMessage?.({ role: 'assistant', content: '', timestamp: new Date(), isStreaming: true });
  }

  streamChunk(chunk: string): void {
    this.callbacks.onUpdateLast?.(msg => ({ ...msg, content: msg.content + chunk }));
  }

  streamEnd(): void {
    this.callbacks.onUpdateLast?.(msg => ({ ...msg, isStreaming: false }));
  }

  streamThinkingStart(): void {
    this.callbacks.onMessage?.({ role: 'thinking', content: '', timestamp: new Date(), isStreaming: true });
  }

  streamThinkingChunk(chunk: string): void {
    this.callbacks.onUpdateLast?.(msg => ({ ...msg, content: msg.content + chunk }));
  }

  streamThinkingEnd(): void {
    this.callbacks.onUpdateLast?.(msg => ({ ...msg, isStreaming: false }));
  }

  updateTokenCount(tokens: number): void {
    this.callbacks.onTokenUpdate?.(tokens);
  }

  clear(): void {
    // No-op for callback display
  }
}
