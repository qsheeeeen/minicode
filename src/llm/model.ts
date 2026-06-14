// Model is pure metadata for the selected LLM model.
//
// The provider client is owned separately by the runtime/agent. The model is
// passed as request configuration, not as a container for execution capability.

import type { LLMClient, EffortLevel } from "./client.js";
import { createClient } from "./client.js";
import { parseModelSpecifier, type AppConfig } from "../config.js";

export class Model {
  private _effort?: EffortLevel;

  constructor(
    private readonly _name: string,
    private readonly _provider: string,
    private readonly _contextLength: number,
    effort?: EffortLevel,
    private readonly _displayName?: string,
  ) {
    this._effort = effort;
  }

  /** Model identifier passed to chatStream options (e.g. "deepseek-chat"). */
  getName(): string {
    return this._name;
  }

  /** Provider name for display (e.g. "anthropic", "deepseek"). */
  getProvider(): string {
    return this._provider;
  }

  /** Context window length for token tracking. */
  getContextLength(): number {
    return this._contextLength;
  }

  /** Human-readable name for display (e.g. "Claude Sonnet"). */
  getDisplayName(): string {
    return this._displayName || this._name;
  }

  /** Reasoning effort level (e.g. "low", "high"). */
  getEffort(): EffortLevel | undefined {
    return this._effort;
  }

  /** Update effort level at runtime. */
  setEffort(effort: EffortLevel): void {
    this._effort = effort;
  }
}

export interface ModelSelection {
  model: Model;
  client: LLMClient;
}

// ModelFactory resolves model metadata and provider clients from AppConfig.

export class ModelFactory {
  constructor(private readonly config: AppConfig) {}

  /** Create a model/client selection from a "model@provider" specifier string. */
  fromSpec(spec: string): ModelSelection | null {
    const parsed = parseModelSpecifier(spec, this.config.providers);
    if (!parsed) return null;

    const protocol = parsed.providerConfig.protocol || "anthropic";
    const client = createClient(
      protocol,
      parsed.providerConfig.apiKey,
      parsed.providerConfig.baseURL,
    );
    const modelConfig = parsed.providerConfig.models?.[parsed.modelName];

    return {
      client,
      model: new Model(
        parsed.modelName,
        parsed.providerName,
        modelConfig?.contextLength ?? 200000,
        undefined, // effort — resolved per-session, not per-model
        modelConfig?.name,
      ),
    };
  }
}
