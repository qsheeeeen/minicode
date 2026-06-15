export type RuntimeEvent = {
  type: "context.tokens_changed";
  tokenCount: number;
};

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export class RuntimeEvents {
  private listeners = new Set<RuntimeEventListener>();

  emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
