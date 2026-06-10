// Model encapsulates an LLM client together with its metadata.
//
// A Model is an immutable atom — switching models means replacing the entire
// object. This guarantees client and metadata are always in sync.

import type { LLMClient } from "./client.js";
import { createClient } from "./client.js";
import {
  loadConfig,
  parseModelSpecifier,
  setModel as persistModel,
  setTier as persistTier,
  type Providers,
} from "../config.js";

export class Model {
  constructor(
    private readonly _client: LLMClient,
    private readonly _name: string,
    private readonly _provider: string,
    private readonly _contextLength: number,
    private readonly _displayName?: string,
  ) {}

  /** The LLM client for making chat requests. */
  getClient(): LLMClient {
    return this._client;
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
}

// ModelFactory creates Model instances from config.

export class ModelFactory {
  private readonly providers: Providers;

  constructor(providers: Providers) {
    this.providers = providers;
  }

  /** Create a Model from a "model@provider" specifier string. */
  fromSpec(spec: string): Model | null {
    const parsed = parseModelSpecifier(spec, this.providers);
    if (!parsed) return null;

    const protocol = parsed.providerConfig.protocol || "anthropic";
    const client = createClient(
      protocol,
      parsed.providerConfig.apiKey,
      parsed.providerConfig.baseURL,
    );
    const modelConfig = parsed.providerConfig.models?.[parsed.modelName];

    return new Model(
      client,
      parsed.modelName,
      parsed.providerName,
      modelConfig?.contextLength ?? 200000,
      modelConfig?.name,
    );
  }

  /** Create a Model by resolving a tier name through config. */
  async fromTier(tier: string): Promise<Model | null> {
    const config = await loadConfig();
    const spec = config.tiers?.[tier];
    if (!spec) return null;
    return this.fromSpec(spec);
  }

  /** Persist a tier mapping and return the resolved Model. */
  async mapTier(tier: string, spec: string): Promise<Model | null> {
    const model = this.fromSpec(spec);
    if (model) {
      await persistTier(tier, spec);
    }
    return model;
  }

  /** Persist the default model specifier. */
  static async persistDefault(spec: string): Promise<void> {
    await persistModel(spec);
  }
}
