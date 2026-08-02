import type { AppConfig } from "../config.js";
import { ModelFactory, type ModelSelection } from "../llm/model.js";
import type { ContextManager } from "./context-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { RuntimeState } from "./runtime-state.js";

export interface ModelSwitchServiceOpts {
  readonly appConfig: AppConfig;
  readonly contextManager: ContextManager;
  readonly sessionManager: SessionManager;
  readonly runtimeState: RuntimeState;
}

export interface SwitchAgentModelOpts {
  readonly modelSpec: string;
  readonly persistDefault?: boolean;
  readonly tier?: string;
  readonly reportStatus?: boolean;
}

export class ModelSwitchService {
  private appConfig: AppConfig;
  private contextManager: ContextManager;
  private sessionManager: SessionManager;
  private runtimeState: RuntimeState;

  constructor(opts: ModelSwitchServiceOpts) {
    this.appConfig = opts.appConfig;
    this.contextManager = opts.contextManager;
    this.sessionManager = opts.sessionManager;
    this.runtimeState = opts.runtimeState;
  }

  async switchAgentModel(opts: SwitchAgentModelOpts): Promise<ModelSelection> {
    const factory = new ModelFactory(this.appConfig);
    const selection = factory.fromSpec(opts.modelSpec);
    if (!selection) {
      throw new Error(`Could not resolve "${opts.modelSpec}".`);
    }
    const { client, model } = selection;

    // runtimeState is the single source of truth; ContextManager and the
    // permission gate subscribe to model.changed in the composition root.
    this.runtimeState.setClientModel(client, model);

    if (opts.tier) {
      await this.appConfig.setTier(opts.tier, opts.modelSpec);
    }
    if (opts.persistDefault ?? true) {
      await this.appConfig.setModel(opts.modelSpec);
    }

    await this.sessionManager.saveStore({
      model: model.getName(),
      totalTokens: this.contextManager.getTokenCount(),
    });

    if (opts.reportStatus ?? true) {
      this.sessionManager.reportStatus({
        role: "status",
        content: `(Model set to: ${opts.modelSpec})`,
        timestamp: new Date(),
      });
    }

    return selection;
  }
}
