import type { Agent } from "../agent.js";
import type { AppConfig } from "../config.js";
import { ModelFactory, type Model } from "../llm/model.js";
import type { ContextManager } from "./context-manager.js";
import type { SessionManager } from "./session-manager.js";

export interface ModelSwitchServiceOpts {
  readonly appConfig: AppConfig;
  readonly contextManager: ContextManager;
  readonly sessionManager: SessionManager;
}

export interface SwitchAgentModelOpts {
  readonly agent: Agent;
  readonly modelSpec: string;
  readonly persistDefault?: boolean;
  readonly tier?: string;
  readonly reportStatus?: boolean;
}

export class ModelSwitchService {
  private appConfig: AppConfig;
  private contextManager: ContextManager;
  private sessionManager: SessionManager;

  constructor(opts: ModelSwitchServiceOpts) {
    this.appConfig = opts.appConfig;
    this.contextManager = opts.contextManager;
    this.sessionManager = opts.sessionManager;
  }

  async switchAgentModel(opts: SwitchAgentModelOpts): Promise<Model> {
    const factory = new ModelFactory(this.appConfig);
    const newModel = factory.fromSpec(opts.modelSpec);
    if (!newModel) {
      throw new Error(`Could not resolve "${opts.modelSpec}".`);
    }

    opts.agent.model = newModel;
    this.contextManager.setContextLength(newModel.getContextLength());

    if (opts.tier) {
      await this.appConfig.setTier(opts.tier, opts.modelSpec);
    }
    if (opts.persistDefault ?? true) {
      await this.appConfig.setModel(opts.modelSpec);
    }

    await this.sessionManager.saveStore({
      model: newModel.getName(),
      totalTokens: this.contextManager.getTokenCount(),
    });

    if (opts.reportStatus ?? true) {
      this.sessionManager.reportStatus({
        role: "status",
        content: `(Model set to: ${opts.modelSpec})`,
        timestamp: new Date(),
      });
    }

    return newModel;
  }
}
