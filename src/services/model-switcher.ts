import type { AppConfig, Tier } from "../config.js";
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

/** Switch outcome as a value — an unresolvable spec is user-input validation,
 *  not an exceptional condition. */
export type ModelSwitchResult =
  | { ok: true; spec: string }
  | { ok: false; reason: string };

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

  /** Switch the session to a tier's current mapping and persist the choice. */
  async switchTier(tier: Tier): Promise<ModelSwitchResult> {
    const spec = this.appConfig.tiers[tier];
    if (!spec) {
      return {
        ok: false,
        reason: `Tier "${tier}" has no model configured. Set tiers.${tier} in ~/.minicode/config.json.`,
      };
    }
    const selection = new ModelFactory(this.appConfig).fromSpec(spec);
    if (!selection) {
      return { ok: false, reason: `Could not resolve "${spec}".` };
    }

    // runtimeState is the single source of truth; ContextManager and the
    // permission gate resolve client/model through its getters.
    await this.appConfig.setActiveTier(tier);
    await this.applySelection(spec, selection);
    return { ok: true, spec };
  }

  /** Point a tier at a new model@provider. Hot-swaps only when that tier is
   *  the active one; otherwise the live model is untouched. */
  async remapTier(tier: Tier, modelSpec: string): Promise<ModelSwitchResult> {
    const selection = new ModelFactory(this.appConfig).fromSpec(modelSpec);
    if (!selection) {
      return { ok: false, reason: `Could not resolve "${modelSpec}".` };
    }

    await this.appConfig.setTier(tier, modelSpec);

    if (tier !== this.appConfig.activeTier) {
      this.sessionManager.reportStatus({
        role: "status",
        content: `(${tier} tier set to: ${modelSpec})`,
      });
      return { ok: true, spec: modelSpec };
    }

    await this.applySelection(modelSpec, selection);
    return { ok: true, spec: modelSpec };
  }

  /** Make a resolved selection live: swap the runtime handles, persist the
   *  session metadata, and announce it. */
  private async applySelection(
    spec: string,
    selection: ModelSelection,
  ): Promise<void> {
    this.runtimeState.setClientModel(selection.client, selection.model);
    await this.sessionManager.saveStore({
      model: selection.model.getName(),
      totalTokens: this.contextManager.getTokenCount(),
    });
    this.sessionManager.reportStatus({
      role: "status",
      content: `(Model set to: ${spec})`,
    });
  }
}
