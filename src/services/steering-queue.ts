// Steering queue — user messages submitted while the agent is running.
//
// Messages are injected between loop iterations (after the current tool
// batch, before the next LLM call) as ordinary user messages. Modeled on
// pi's PendingMessageQueue, collapsed to a single queue: whatever is queued
// mid-run either steers the next iteration or, if the agent was about to
// stop, drives one more round (pi's followUp semantics).

import type { RuntimeEvents } from "./runtime-events.js";

export class SteeringQueue {
  private messages: string[] = [];
  private readonly events?: RuntimeEvents;

  constructor(events?: RuntimeEvents) {
    this.events = events;
  }

  /** Queue a message for injection. Empty/whitespace text is ignored. */
  enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.messages.push(trimmed);
    this.emit();
  }

  /** Take all queued messages (oldest first) and clear the queue. */
  drain(): string[] {
    if (this.messages.length === 0) return [];
    const drained = this.messages;
    this.messages = [];
    this.emit();
    return drained;
  }

  /** Drop everything without returning it (abort path). */
  clear(): void {
    if (this.messages.length === 0) return;
    this.messages = [];
    this.emit();
  }

  /** Read-only snapshot of what is queued (UI display). */
  peek(): readonly string[] {
    return [...this.messages];
  }

  get size(): number {
    return this.messages.length;
  }

  private emit(): void {
    this.events?.emit({ type: "queue.changed", messages: [...this.messages] });
  }
}
