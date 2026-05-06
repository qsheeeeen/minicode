import React from 'react';
import type { DisplayMessage } from '../messages.js';

export type { DisplayMessage };

type DisplayCallback = {
  onMessage?: (msg: DisplayMessage) => void;
  onTokenUpdate?: (tokens: number) => void;
  onConfirm?: (req: ConfirmationRequest) => Promise<boolean>;
  onAskUser?: (req: AskUserQuestion) => Promise<string>;
};

export interface ConfirmationRequest {
  title: string;
  message: string;
}

export interface AskUserQuestion {
  question: string;
  options: Array<{ label: string; description: string }>;
}

export interface DisplayAdapter {
  status(msg: string): void;
  error(msg: string): void;
  updateTokenCount(tokens: number): void;
  confirm?(req: ConfirmationRequest): Promise<boolean>;
  askUser?(req: AskUserQuestion): Promise<string>;
}

export class ConsoleDisplay implements DisplayAdapter {
  status(msg: string): void { console.log(`[Status] ${msg}`); }
  error(msg: string): void { console.log(`[Error] ${msg}`); }
  updateTokenCount(_tokens: number): void {}
  async askUser(req: AskUserQuestion): Promise<string> {
    console.log(`[AskUser] ${req.question}`);
    for (const o of req.options) {
      console.log(`  [${o.label}] ${o.description}`);
    }
    return '';
  }
}

export interface DisplayEvent {
  type: 'status' | 'error' | 'tokenCount';
  data: string | number;
  timestamp: Date;
}

export class RecordDisplay implements DisplayAdapter {
  events: DisplayEvent[] = [];

  status(msg: string): void {
    this.events.push({ type: 'status', data: msg, timestamp: new Date() });
  }

  error(msg: string): void {
    this.events.push({ type: 'error', data: msg, timestamp: new Date() });
  }

  updateTokenCount(tokens: number): void {
    this.events.push({ type: 'tokenCount', data: tokens, timestamp: new Date() });
  }

  async askUser(req: AskUserQuestion): Promise<string> {
    this.events.push({ type: 'status', data: `[AskUser] ${req.question}`, timestamp: new Date() });
    return '';
  }
}

export class CallbackDisplay implements DisplayAdapter {
  constructor(private callbacks: DisplayCallback) {}

  status(msg: string): void {
    this.callbacks.onMessage?.({ role: 'status', content: msg, timestamp: new Date() });
  }

  error(msg: string): void {
    this.callbacks.onMessage?.({ role: 'error', content: msg, timestamp: new Date() });
  }

  updateTokenCount(tokens: number): void {
    this.callbacks.onTokenUpdate?.(tokens);
  }

  confirm(req: ConfirmationRequest): Promise<boolean> {
    return this.callbacks.onConfirm?.(req) ?? Promise.resolve(true);
  }

  askUser(req: AskUserQuestion): Promise<string> {
    return this.callbacks.onAskUser?.(req) ?? Promise.resolve('');
  }
}
