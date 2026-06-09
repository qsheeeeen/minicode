import { describe, it, expect, vi } from "vitest";
import { Signal } from "./signal.js";

describe("Signal", () => {
  it("holds an initial value", () => {
    const s = new Signal(42);
    expect(s.get()).toBe(42);
  });

  it("updates value via set()", () => {
    const s = new Signal("hello");
    s.set("world");
    expect(s.get()).toBe("world");
  });

  it("notifies subscribers on change", () => {
    const s = new Signal(0);
    const listener = vi.fn();
    s.subscribe(listener);

    s.set(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("does not notify when value is unchanged", () => {
    const s = new Signal("same");
    const listener = vi.fn();
    s.subscribe(listener);

    s.set("same");
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies multiple subscribers", () => {
    const s = new Signal(0);
    const a = vi.fn();
    const b = vi.fn();
    s.subscribe(a);
    s.subscribe(b);

    s.set(99);
    expect(a).toHaveBeenCalledWith(99);
    expect(b).toHaveBeenCalledWith(99);
  });

  it("unsubscribe stops notifications", () => {
    const s = new Signal(0);
    const listener = vi.fn();
    const unsub = s.subscribe(listener);

    unsub();
    s.set(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple sequential changes", () => {
    const s = new Signal(0);
    const values: number[] = [];
    s.subscribe((v) => values.push(v));

    s.set(1);
    s.set(2);
    s.set(3);

    expect(values).toEqual([1, 2, 3]);
    expect(s.get()).toBe(3);
  });

  it("handles object values with reference equality", () => {
    const obj = { count: 0 };
    const s = new Signal(obj);
    const listener = vi.fn();
    s.subscribe(listener);

    // Same reference → no notification
    s.set(obj);
    expect(listener).not.toHaveBeenCalled();

    // New reference → notification
    const newObj = { count: 1 };
    s.set(newObj);
    expect(listener).toHaveBeenCalledWith(newObj);
  });

  it("unsubscribe is idempotent", () => {
    const s = new Signal(0);
    const listener = vi.fn();
    const unsub = s.subscribe(listener);

    unsub();
    unsub(); // second call should be safe
    s.set(1);

    expect(listener).not.toHaveBeenCalled();
  });
});
