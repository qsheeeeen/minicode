export interface ToolDisplayPayload {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

export interface RuntimeStatus {
  role: "status" | "error";
  content: string;
  /** Placement: which user message (0-based) this status follows. */
  userMessageIndex?: number;
  /** Render as a tool call/result instead of a status line. */
  toolDisplay?: ToolDisplayPayload;
}

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

  /** Single owner of the status.added emission and its placement rule: an
   *  unindexed status belongs after the latest user message. */
  emitStatus(status: RuntimeStatus, currentUserMessageCount: number): void {
    this.emit({
      type: "status.added",
      status: {
        ...status,
        userMessageIndex: status.userMessageIndex ?? currentUserMessageCount,
      },
    });
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
