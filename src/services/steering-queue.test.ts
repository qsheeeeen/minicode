import { describe, it, expect, vi } from "vitest";
import { SteeringQueue } from "./steering-queue.js";
import { RuntimeEvents, type RuntimeEvent } from "./runtime-events.js";

describe("SteeringQueue", () => {
  it("enqueue trims and ignores empty text", () => {
    const q = new SteeringQueue();
    q.enqueue("  hello  ");
    q.enqueue("   ");
    q.enqueue("");
    expect(q.peek()).toEqual(["hello"]);
    expect(q.size).toBe(1);
  });

  it("drain returns messages oldest-first and empties the queue", () => {
    const q = new SteeringQueue();
    q.enqueue("first");
    q.enqueue("second");
    expect(q.drain()).toEqual(["first", "second"]);
    expect(q.size).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("clear drops everything without returning it", () => {
    const q = new SteeringQueue();
    q.enqueue("a");
    q.enqueue("b");
    q.clear();
    expect(q.size).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("emits queue.changed with a copy of the queue on every mutation", () => {
    const events = new RuntimeEvents();
    const seen: RuntimeEvent[] = [];
    events.subscribe((e) => seen.push(e));

    const q = new SteeringQueue(events);
    q.enqueue("one");
    q.enqueue("two");
    q.drain();
    q.clear(); // empty clear emits nothing

    const queueEvents = seen.filter((e) => e.type === "queue.changed");
    expect(queueEvents.map((e) => (e as any).messages)).toEqual([
      ["one"],
      ["one", "two"],
      [],
    ]);
  });

  it("mutating the peek() view does not affect the queue", () => {
    const q = new SteeringQueue();
    q.enqueue("keep");
    const view = q.peek() as string[];
    expect(() => view.push("injected")).not.toThrow();
    expect(q.peek()).toEqual(["keep"]);
  });

  it("event emission is optional (no events wired)", () => {
    const q = new SteeringQueue();
    expect(() => {
      q.enqueue("x");
      q.drain();
    }).not.toThrow();
  });

  it("listeners see a snapshot, not the live array", () => {
    const events = new RuntimeEvents();
    let received: string[] | undefined;
    events.subscribe((e) => {
      if (e.type === "queue.changed") received = e.messages;
    });
    const q = new SteeringQueue(events);
    q.enqueue("one");
    received!.push("tampered");
    expect(q.peek()).toEqual(["one"]);
    expect(() => q.enqueue("two")).not.toThrow();
  });
});

describe("SteeringQueue vi integration", () => {
  it("works with a spy subscriber", () => {
    const events = new RuntimeEvents();
    const spy = vi.fn();
    events.subscribe(spy);
    const q = new SteeringQueue(events);
    q.enqueue("msg");
    expect(spy).toHaveBeenCalledWith({
      type: "queue.changed",
      messages: ["msg"],
    });
  });
});
