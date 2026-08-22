import fsPromises from "fs/promises";
import path from "path";
import type { EffortLevel } from "./llm/client.js";
import { MINICODE_HOME } from "./utils/paths.js";

const DEFAULT_CONFIG_PATH = path.join(MINICODE_HOME, "config.json");

export interface ModelConfig {
  contextLength?: number;
  name?: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  protocol?: string; // "anthropic" | "openai" | "openai-responses" — defaults to "anthropic"
  models?: Record<string, ModelConfig>;
}

export interface Providers {
  anthropic?: ProviderConfig;
  [key: string]: ProviderConfig | undefined;
}

export interface ThinkingConfig {
  effort?: EffortLevel;
}

/** Tier names recognized in model config and pickers (pro = primary,
 *  flash = fast/cheap). One definition; pickers and parsers follow. */
export const TIERS = ["pro", "flash"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(v: string): v is Tier {
  return (TIERS as readonly string[]).includes(v);
}

/** Raw on-disk config shape (all fields optional). */
export interface Config {
  providers?: Providers;
  tiers?: Partial<Record<Tier, string>>; // tier -> model@provider
  activeTier?: string; // raw/unvalidated; the getter validates and falls back
  /** @deprecated legacy top-level model — folded into tiers.pro at construction */
  model?: string;
  compressionThreshold?: number; // 0-1, compress at this ratio of context
  thinking?: ThinkingConfig;
  effort?: EffortLevel; // legacy: top-level effort, now nested under thinking
  permissionMode?: "manual" | "yolo" | "auto";
}

/** Resolved model descriptor (flattened from a model@provider spec). */
export interface ResolvedModel {
  provider: string;
  protocol: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  contextLength?: number;
  displayName?: string;
}

export function parseModelSpecifier(
  spec: string,
  providers: Providers,
): {
  modelName: string;
  providerName: string;
  providerConfig: ProviderConfig;
} | null {
  const parts = spec.split("@");
  const modelName = parts[0];
  const providerName = parts[1] || Object.keys(providers || {})[0];
  const providerConfig = providers?.[providerName];
  if (!providerConfig?.apiKey) return null;
  return { modelName, providerName, providerConfig };
}

/** Resolve a model@provider spec into a flattened descriptor (pure). */
export function resolveModel(
  spec: string,
  providers: Providers,
): ResolvedModel | null {
  const parsed = parseModelSpecifier(spec, providers);
  if (!parsed) return null;
  const modelConfig = parsed.providerConfig.models?.[parsed.modelName];
  return {
    provider: parsed.providerName,
    protocol: parsed.providerConfig.protocol || "anthropic",
    model: parsed.modelName,
    apiKey: parsed.providerConfig.apiKey!,
    baseURL: parsed.providerConfig.baseURL,
    contextLength: modelConfig?.contextLength,
    displayName: modelConfig?.name,
  };
}

/**
 * AppConfig — the single app configuration instance. Created once at startup
 * via `AppConfig.load()` and threaded through dependency injection. Since the
 * instance is shared by reference, mutators update it in place (+ persist to
 * disk) and every consumer sees the change immediately — replacing the old
 * module-level cache.
 */
export class AppConfig {
  private raw: Config;
  private readonly configPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(raw: Config = {}, configPath: string = DEFAULT_CONFIG_PATH) {
    // Lazy legacy migration: fold a top-level `model` into tiers.pro (tiers
    // win). In-memory only; the next mutator write persists the new shape.
    if (raw.model) {
      raw.tiers ??= {};
      raw.tiers.pro ??= raw.model;
      delete raw.model;
    }
    this.raw = raw;
    this.configPath = configPath;
  }

  /** Read the config file once and return a fresh instance (no caching). */
  static async load(
    configPath: string = DEFAULT_CONFIG_PATH,
  ): Promise<AppConfig> {
    let raw: Config = {};
    try {
      await fsPromises.mkdir(path.dirname(configPath), { recursive: true });
      raw = JSON.parse(
        await fsPromises.readFile(configPath, "utf-8"),
      ) as Config;
    } catch {
      // Missing or unreadable config — start empty
    }
    return new AppConfig(raw, configPath);
  }

  // --- resolved/normalized getters ---

  get providers(): Providers {
    return this.raw.providers ?? {};
  }

  /** Active tier: validates the raw value, then falls back to the first
   *  tier that has a spec so "current model = tiers[activeTier]" holds. */
  get activeTier(): Tier {
    const preferred: Tier =
      this.raw.activeTier && isTier(this.raw.activeTier)
        ? this.raw.activeTier
        : "pro";
    if (this.tiers[preferred]) return preferred;
    return TIERS.find((t) => this.tiers[t]) ?? preferred;
  }

  get tiers(): Partial<Record<Tier, string>> {
    return this.raw.tiers ?? {};
  }

  get modelSpec(): string | undefined {
    return this.tiers[this.activeTier];
  }

  get model(): ResolvedModel | null {
    return this.modelSpec
      ? resolveModel(this.modelSpec, this.providers)
      : null;
  }

  get compressionThreshold(): number {
    return this.raw.compressionThreshold ?? 0.8;
  }

  get thinking(): { effort?: EffortLevel } {
    const effort =
      typeof this.raw.thinking === "object" && this.raw.thinking?.effort
        ? this.raw.thinking.effort
        : this.raw.effort;
    return { effort };
  }

  get permissionMode(): "manual" | "yolo" | "auto" {
    return this.raw.permissionMode ?? "manual";
  }

  /** Resolve an arbitrary model@provider spec against current providers. */
  resolveModel(spec: string): ResolvedModel | null {
    return resolveModel(spec, this.providers);
  }

  // --- mutators: update in-memory synchronously, then persist ---

  async setActiveTier(tier: Tier): Promise<void> {
    this.raw.activeTier = tier;
    await this.persist();
  }

  async setEffort(effort: EffortLevel): Promise<void> {
    if (typeof this.raw.thinking !== "object" || this.raw.thinking === null) {
      this.raw.thinking = {};
    }
    this.raw.thinking.effort = effort;
    await this.persist();
  }

  async setTier(tier: Tier, modelSpec: string): Promise<void> {
    if (!this.raw.tiers) this.raw.tiers = {};
    this.raw.tiers[tier] = modelSpec;
    await this.persist();
  }

  /** Serialize concurrent writes so they apply in order. */
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.raw, null, 2);
    this.writeChain = this.writeChain.then(() =>
      fsPromises.writeFile(this.configPath, snapshot, "utf-8"),
    );
    return this.writeChain;
  }
}
