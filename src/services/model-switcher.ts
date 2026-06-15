import type { AppConfig } from "../config.js";
import { ModelFactory, type ModelSelection } from "../llm/model.js";
import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { ContextManager } from "./context-manager.js";
import type { PermissionService } from "./permission.js";
import type { SessionManager } from "./session-manager.js";

export interface ModelSwitchServiceOpts {
  readonly appConfig: AppConfig;
  readonly contextManager: ContextManager;
  readonly sessionManager: SessionManager;
  readonly setModel: (client: LLMClient, model: Model) => void;
  readonly permissionService?: PermissionService;
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
  private setModel: (client: LLMClient, model: Model) => void;
  private permissionService?: PermissionService;

  constructor(opts: ModelSwitchServiceOpts) {
    this.appConfig = opts.appConfig;
    this.contextManager = opts.contextManager;
    this.sessionManager = opts.sessionManager;
    this.setModel = opts.setModel;
    this.permissionService = opts.permissionService;
  }

  async switchAgentModel(opts: SwitchAgentModelOpts): Promise<ModelSelection> {
    const factory = new ModelFactory(this.appConfig);
    const selection = factory.fromSpec(opts.modelSpec);
    if (!selection) {
      throw new Error(`Could not resolve "${opts.modelSpec}".`);
    }
    const { client, model } = selection;

    this.setModel(client, model);
    this.contextManager.setModel(client, model);
    this.permissionService?.updateAutoGate(client, model);

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
