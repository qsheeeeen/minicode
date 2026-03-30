import type { Agent } from '../agent.js';
import type { DisplayAdapter } from '../utils/display.js';
import type { DisplayMessage } from '../utils/session-display.js';

export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';

export interface AgentSession {
  id: string;              // "1" (主 agent), "2", "3", ... (子 agent)
  type: 'main' | 'sub';
  agent: Agent;
  display: DisplayAdapter;
  messages: DisplayMessage[];
  status: AgentStatus;
  task?: string;           // 子 agent 的任务描述
  parentId?: string;       // 对于子 agent，记录父 agent
  summary?: string;        // 完成后的摘要
}

export type AgentRegistryUpdateCallback = (sessions: AgentSession[]) => void;

export class AgentRegistry {
  private sessions: Map<string, AgentSession> = new Map();
  private nextSubId = 2;   // 下一个子 agent 编号（从 2 开始）
  private updateCallback?: AgentRegistryUpdateCallback;

  setUpdateCallback(callback: AgentRegistryUpdateCallback): void {
    this.updateCallback = callback;
  }

  private notifyUpdate(): void {
    if (this.updateCallback) {
      this.updateCallback(this.getAll());
    }
  }

  register(session: AgentSession): void {
    this.sessions.set(session.id, session);
    this.notifyUpdate();
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  getAll(): AgentSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      // 按编号排序
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      return numA - numB;
    });
  }

  getActiveSessions(): AgentSession[] {
    return this.getAll().filter(s => s.status === 'running');
  }

  updateStatus(id: string, status: AgentStatus): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = status;
    }
  }

  updateSummary(id: string, summary: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.summary = summary;
    }
  }

  addMessage(id: string, message: DisplayMessage): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messages.push(message);
      this.notifyUpdate();
    }
  }

  allocateSubId(): string {
    // Find the first available ID (2-9)
    for (let i = 2; i <= 9; i++) {
      const id = String(i);
      if (!this.sessions.has(id)) {
        // Update nextSubId to continue searching from here next time
        this.nextSubId = i + 1;
        if (this.nextSubId > 9) {
          this.nextSubId = 2;
        }
        return id;
      }
    }
    // All IDs 2-9 are in use, still return the next one (caller should handle this)
    const id = String(this.nextSubId);
    this.nextSubId++;
    if (this.nextSubId > 9) {
      this.nextSubId = 2;
    }
    return id;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  clear(): void {
    this.sessions.clear();
    this.nextSubId = 2;
  }
}
