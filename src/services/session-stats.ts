export interface PerModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface ModelUsage {
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
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

  recordUsage(
    model: string,
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number,
  ): void {
    if (!this.perModel.has(model)) {
      this.perModel.set(model, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
      });
      this.modelsUsedInOrder.push(model);
    }
    const entry = this.perModel.get(model)!;
    entry.inputTokens += input;
    entry.outputTokens += output;
    entry.cacheCreation += cacheCreation;
    entry.cacheRead += cacheRead;
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
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        cacheCreation: t.cacheCreation,
        cacheRead: t.cacheRead,
        total: t.inputTokens + t.outputTokens + t.cacheCreation + t.cacheRead,
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
