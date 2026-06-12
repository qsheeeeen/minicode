import type { DisplayMessage, StatusMessage } from "../messages.js";

export type { DisplayMessage };

/**
 * Callback interface for reporting UI status messages.
 * Services (Agent, ContextManager, TokenTracker) use this
 * to emit status/error notifications without knowing about
 * the UI layer (Zustand, console, etc.).
 */
export type StatusReporter = (msg: Omit<StatusMessage, "turnIndex">) => void;

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

// Request-response: agent asks, human answers
export interface UserPrompter {
  prompt(req: Prompt): Promise<string>;
}

export class ConsolePrompter implements UserPrompter {
  async prompt(req: Prompt): Promise<string> {
    console.log(`[Prompt] ${req.message}`);
    for (const o of req.options) {
      console.log(`  [${o.value}] ${o.description ?? ""}`);
    }
    return "";
  }
}

export interface EventRecord {
  type: "status" | "error" | "tokenUpdate";
  data: string | number;
  timestamp: Date;
}

export class RecordPrompter implements UserPrompter {
  events: EventRecord[] = [];

  async prompt(req: Prompt): Promise<string> {
    this.events.push({
      type: "status",
      data: `[Prompt] ${req.message}`,
      timestamp: new Date(),
    });
    return "";
  }
}

export class CallbackPrompter implements UserPrompter {
  constructor(private onPrompt: (req: Prompt) => Promise<string>) {}

  prompt(req: Prompt): Promise<string> {
    return this.onPrompt(req);
  }
}
