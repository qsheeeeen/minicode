import React from 'react';
import type { DisplayMessage } from '../messages.js';

export type { DisplayMessage };

export interface PromptOption {
  label: string;
  value: string;
  description?: string;
}

export interface Prompt {
  message: string;
  options: PromptOption[];
  multiSelect?: boolean;
}

/** Push notifications: agent → human */
export interface AgentEvents {
  status(msg: string): void;
  error(msg: string): void;
  tokenUpdate(tokens: number): void;
}

/** Request-response: agent asks, human answers */
export interface UserPrompter {
  prompt(req: Prompt): Promise<string>;
}

// -- console implementations ------------------------------------------------

export class ConsoleEvents implements AgentEvents {
  status(msg: string): void { console.log(`[Status] ${msg}`); }
  error(msg: string): void { console.log(`[Error] ${msg}`); }
  tokenUpdate(_tokens: number): void {}
}

export class ConsolePrompter implements UserPrompter {
  async prompt(req: Prompt): Promise<string> {
    console.log(`[Prompt] ${req.message}`);
    for (const o of req.options) {
      console.log(`  [${o.value}] ${o.description ?? ''}`);
    }
    return '';
  }
}

// -- recording implementations (for tests) ----------------------------------

export interface EventRecord {
  type: 'status' | 'error' | 'tokenUpdate';
  data: string | number;
  timestamp: Date;
}

export class RecordEvents implements AgentEvents {
  events: EventRecord[] = [];

  status(msg: string): void {
    this.events.push({ type: 'status', data: msg, timestamp: new Date() });
  }
  error(msg: string): void {
    this.events.push({ type: 'error', data: msg, timestamp: new Date() });
  }
  tokenUpdate(tokens: number): void {
    this.events.push({ type: 'tokenUpdate', data: tokens, timestamp: new Date() });
  }
}

export class RecordPrompter implements UserPrompter {
  events: EventRecord[] = [];

  async prompt(req: Prompt): Promise<string> {
    this.events.push({ type: 'status', data: `[Prompt] ${req.message}`, timestamp: new Date() });
    return '';
  }
}

// -- TUI callbacks ----------------------------------------------------------

type TuiCallbacks = {
  onStatus?: (msg: DisplayMessage) => void;
  onTokenUpdate?: (tokens: number) => void;
  onPrompt?: (req: Prompt) => Promise<string>;
};

export class CallbackEvents implements AgentEvents {
  constructor(private cb: { onStatus?: (msg: DisplayMessage) => void; onTokenUpdate?: (tokens: number) => void }) {}

  status(msg: string): void {
    this.cb.onStatus?.({ role: 'status', content: msg, timestamp: new Date() });
  }
  error(msg: string): void {
    this.cb.onStatus?.({ role: 'error', content: msg, timestamp: new Date() });
  }
  tokenUpdate(tokens: number): void {
    this.cb.onTokenUpdate?.(tokens);
  }
}

export class CallbackPrompter implements UserPrompter {
  constructor(private onPrompt: (req: Prompt) => Promise<string>) {}

  prompt(req: Prompt): Promise<string> {
    return this.onPrompt(req);
  }
}
