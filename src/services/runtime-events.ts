export interface RuntimeStatus {
  role: "status" | "error";
  content: string;
  timestamp: Date;
  userMessageIndex?: number;
  element?: unknown;
  toolDisplay?: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
  };
}

export type RuntimeStatusInput = Omit<RuntimeStatus, "userMessageIndex"> & {
  userMessageIndex?: number;
};

export type RuntimeEvent =
  | { type: "context.tokens_changed"; tokenCount: number }
  | {
      type: "status.added";
      status: RuntimeStatus;
    }
  | { type: "session.changed"; sessionName: string }
  | { type: "permission.mode_changed"; mode: "manual" | "yolo" | "auto" };

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
