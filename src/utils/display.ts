/**
 * Display adapter for TUI/Console output
 * Provides an abstraction layer for different display modes
 */

import type { MessageRole, DisplayMessage } from './session-display.js';

// Re-export for convenience
export type { MessageRole, DisplayMessage };

export type DisplayCallback = {
  onMessage?: (msg: DisplayMessage) => void;
  onStreamStart?: () => void;
  onStreamChunk?: (chunk: string) => void;
  onStreamEnd?: () => void;
  onStatusUpdate?: (status: string) => void;
  onTokenUpdate?: (tokens: number) => void;
};

export interface DisplayAdapter {
  /** Display a system message */
  system(msg: string): void;

  /** Display a tool call */
  toolCall(msg: string): void;

  /** Display a tool result */
  toolResult(msg: string): void;

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

  toolResult(msg: string): void {
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

  toolResult(msg: string): void {
    // Show tool results as output
    this.callbacks.onMessage?.({ role: 'tool', content: msg, timestamp: new Date() });
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
    this.callbacks.onStreamStart?.();
  }

  streamChunk(chunk: string): void {
    this.callbacks.onStreamChunk?.(chunk);
  }

  streamEnd(): void {
    this.callbacks.onStreamEnd?.();
  }

  updateTokenCount(tokens: number): void {
    this.callbacks.onTokenUpdate?.(tokens);
  }

  clear(): void {
    // No-op for callback display
  }
}

// Re-export logger functions using console display for backward compatibility
const consoleDisplay = new ConsoleDisplay();

export function system(msg: string): void {
  consoleDisplay.system(msg);
}

export function toolCall(msg: string): void {
  consoleDisplay.toolCall(msg);
}

export function toolResult(msg: string): void {
  consoleDisplay.toolResult(msg);
}

export function error(msg: string): void {
  consoleDisplay.error(msg);
}

export function progress(msg: string): void {
  consoleDisplay.progress(msg);
}

export function raw(msg: string): void {
  consoleDisplay.raw(msg);
}
