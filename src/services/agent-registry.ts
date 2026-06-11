import type { Agent } from "../agent.js";
import type { MessageStore } from "../messages.js";

export type AgentStatus = "idle" | "running" | "completed" | "error";

export interface AgentSession {
  id: string;
  type: "main" | "sub";
  agent: Agent;
  store: MessageStore;
  status: AgentStatus;
  task?: string;
  parentId?: string;
  summary?: string;
  tokenCount?: number;
  toolCalls?: number;
}

export type AgentRegistryUpdateCallback = (sessions: AgentSession[]) => void;

export class AgentRegistry {
  private sessions: Map<string, AgentSession> = new Map();
  private nextSubId = 2;
  private updateCallback?: AgentRegistryUpdateCallback;

  setUpdateCallback(callback: AgentRegistryUpdateCallback): void {
    this.updateCallback = callback;
  }

  private notifyUpdate(): void {
    this.updateCallback?.(this.getAll());
  }

  register(session: AgentSession): void {
    this.sessions.set(session.id, session);
    this.notifyUpdate();
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  getAll(): AgentSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => parseInt(a.id, 10) - parseInt(b.id, 10),
    );
  }

  updateStatus(id: string, status: AgentStatus): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = status;
      this.notifyUpdate();
    }
  }

  updateSummary(id: string, summary: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.summary = summary;
      this.notifyUpdate();
    }
  }

  updateProgress(
    id: string,
    updates: { tokenCount?: number; toolCalls?: number },
  ): void {
    const session = this.sessions.get(id);
    if (session) {
      if (updates.tokenCount !== undefined)
        session.tokenCount = updates.tokenCount;
      if (updates.toolCalls !== undefined)
        session.toolCalls = updates.toolCalls;
      this.notifyUpdate();
    }
  }

  allocateSubId(): string {
    for (let i = 2; i <= 9; i++) {
      const id = String(i);
      if (!this.sessions.has(id)) {
        this.nextSubId = i + 1 > 9 ? 2 : i + 1;
        return id;
      }
    }
    for (let i = 2; i <= 9; i++) {
      const id = String(i);
      const session = this.sessions.get(id);
      if (
        session &&
        session.type === "sub" &&
        (session.status === "completed" || session.status === "error")
      ) {
        this.sessions.delete(id);
        this.nextSubId = i + 1 > 9 ? 2 : i + 1;
        this.notifyUpdate();
        return id;
      }
    }
    const id = String(this.nextSubId);
    this.nextSubId++;
    if (this.nextSubId > 9) this.nextSubId = 2;
    return id;
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.notifyUpdate();
  }

  clear(): void {
    this.sessions.clear();
    this.nextSubId = 2;
  }
}
