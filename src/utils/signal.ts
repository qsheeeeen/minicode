/**
 * Minimal reactive value container.
 *
 * Write via set(), read via get(), react via subscribe().
 * No stale references, no callback interfaces, no manual propagation.
 */
export class Signal<T> {
  private subs = new Set<(val: T) => void>();

  constructor(private val: T) {}

  get(): T {
    return this.val;
  }

  set(next: T): void {
    if (this.val === next) return;
    this.val = next;
    for (const fn of this.subs) fn(next);
  }

  subscribe(fn: (val: T) => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}
