import type { LLMContext } from "../llm/context.js";
import type { RuntimeStatus } from "../services/runtime-events.js";
import { toDisplayMessages, type DisplayMessage } from "./display.js";

/**
 * SessionTimeline — the single derived view over the agent's block stream.
 *
 * It owns the display-side bookkeeping both renderers need (status messages,
 * user-message display overrides) and recomputes DisplayMessage[] from the
 * LLMContext, which stays the single source of truth. Consumers subscribe via
 * onMessages() and drive recomputation with sync() when the context changes;
 * renderers (TUI state, headless printer) stay pure consumers.
 */
export class SessionTimeline {
  private statuses: RuntimeStatus[] = [];
  private displays = new Map<number, string>();
  private listeners = new Set<(messages: DisplayMessage[]) => void>();

  constructor(
    private context: LLMContext,
    onMessages?: (messages: DisplayMessage[]) => void,
  ) {
    if (onMessages) this.listeners.add(onMessages);
  }

  getContext(): LLMContext {
    return this.context;
  }

  appendStatus(status: RuntimeStatus): void {
    this.statuses.push(status);
    this.sync();
  }

  /** Override the displayed text for the user message at `userIndex` (0-based). */
  setDisplay(userIndex: number, display: string): void {
    this.displays.set(userIndex, display);
  }

  getDisplay(userIndex: number): string | undefined {
    return this.displays.get(userIndex);
  }

  getMessages(): DisplayMessage[] {
    return toDisplayMessages(
      this.context.getBlocks(),
      this.statuses,
      this.displays,
    );
  }

  getStatuses(): readonly RuntimeStatus[] {
    return this.statuses;
  }

  /** Recompute the derived view and notify listeners. */
  sync(): void {
    const messages = this.getMessages();
    for (const listener of this.listeners) listener(messages);
  }

  onMessages(listener: (messages: DisplayMessage[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
