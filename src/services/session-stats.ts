import type { TokenUsage } from "../llm/client.js";

export interface PerModelTokens {
  input: number;
  output: number;
  cacheMiss: number;
  cacheHit: number;
}

export interface ModelUsage {
  name: string;
  input: number;
  output: number;
  cacheMiss: number;
  cacheHit: number;
  total: number;
}

export interface ReceiptData {
  projectName: string;
  startTime: number;
  sessionCount: number;
  sessionNames: string[];
  models: ModelUsage[];
  totalTokens: number;
}

export class SessionStats {
  private startTime = 0;
  private sessionCount = 1;
  private sessionNames: string[] = [];
  private projectName = "";
  private perModel = new Map<string, PerModelTokens>();
  private modelsUsedInOrder: string[] = [];

  init(startTime: number, projectName: string, initialSession: string): void {
    this.startTime = startTime;
    this.projectName = projectName;
    this.sessionNames = [initialSession];
  }

  recordUsage(model: string, usage: TokenUsage): void {
    if (!this.perModel.has(model)) {
      this.perModel.set(model, {
        input: 0,
        output: 0,
        cacheMiss: 0,
        cacheHit: 0,
      });
      this.modelsUsedInOrder.push(model);
    }
    const entry = this.perModel.get(model)!;
    entry.input += usage.input.total;
    entry.output += usage.output;
    entry.cacheMiss += usage.input.cache_miss;
    entry.cacheHit += usage.input.cache_hit;
  }

  incrementSessionCount(sessionName: string): void {
    this.sessionCount++;
    this.sessionNames.push(sessionName);
  }

  getStats(): ReceiptData {
    const models: ModelUsage[] = this.modelsUsedInOrder.map((name) => {
      const t = this.perModel.get(name)!;
      return {
        name,
        input: t.input,
        output: t.output,
        cacheMiss: t.cacheMiss,
        cacheHit: t.cacheHit,
        total: t.input + t.output,
      };
    });
    const totalTokens = models.reduce((sum, m) => sum + m.total, 0);
    return {
      projectName: this.projectName,
      startTime: this.startTime,
      sessionCount: this.sessionCount,
      sessionNames: this.sessionNames,
      models,
      totalTokens,
    };
  }
}
