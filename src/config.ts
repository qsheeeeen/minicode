import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";
import type { EffortLevel } from "./llm/anthropic.js";

const CONFIG_DIR = path.join(os.homedir(), ".minicode");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");


export interface ModelConfig {
  contextLength?: number;
  name?: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  models?: Record<string, ModelConfig>;
}

export interface Providers {
  anthropic?: ProviderConfig;
  zhipu?: ProviderConfig;
  [key: string]: ProviderConfig | undefined;
}

export interface ThinkingConfig {
  effort?: EffortLevel;
}

export interface Config {
  providers?: Providers;
  model?: string; // format: model@provider, e.g. "glm-4.7@zhipu"
  tiers?: Record<string, string>; // tier -> model@provider, e.g. { "pro": "claude-sonnet@anthropic", "flash": "glm-4.7@zhipu" }
  compressionThreshold?: number; // 0-1, compress at this ratio of context
  thinking?: ThinkingConfig; // thinking configuration (Go writes { effort: "high" })
  effort?: EffortLevel; // legacy: top-level effort, now nested under thinking
  permissionMode?: "manual" | "yolo" | "auto";
}

let cachedConfig: Config | null = null;


export async function loadConfig(refresh = false): Promise<Config> {
  if (cachedConfig && !refresh) return cachedConfig;

  try {
    await fsPromises.mkdir(CONFIG_DIR, { recursive: true });
    const content = await fsPromises.readFile(CONFIG_PATH, "utf-8");
    cachedConfig = JSON.parse(content) as Config;
    return cachedConfig ?? {};
  } catch {
    // 配置文件不存在，返回空配置
    return {};
  }
}

export function invalidateConfig(): void {
  cachedConfig = null;
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

export function loadConfigSync(): Config {
  try {
    const content = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

export interface ResolvedConfig {
  model: {
    provider: string;
    model: string;
    apiKey: string;
    baseURL?: string;
    contextLength?: number;
    displayName?: string;
  } | null;
  compressionThreshold: number;
  thinking: { enabled: boolean; effort?: EffortLevel };
  permissionMode?: "manual" | "yolo" | "auto";
}

export async function loadAllConfig(
  modelSpecifier?: string,
): Promise<ResolvedConfig> {
  const config = await loadConfig();
  const spec = modelSpecifier || process.env.MODEL || config.model;

  let model: ResolvedConfig["model"] = null;
  if (spec) {
    const parsed = parseModelSpecifier(spec, config.providers ?? {});
    if (parsed) {
      const modelConfig = parsed.providerConfig.models?.[parsed.modelName];
      model = {
        provider: parsed.providerName,
        model: parsed.modelName,
        apiKey: parsed.providerConfig.apiKey!,
        baseURL: parsed.providerConfig.baseURL,
        contextLength: modelConfig?.contextLength,
        displayName: modelConfig?.name,
      };
    }
  }

  const effort =
    typeof config.thinking === "object" && config.thinking?.effort
      ? config.thinking.effort
      : config.effort;

  return {
    model,
    compressionThreshold: config.compressionThreshold ?? 0.8,
    thinking: {
      enabled: typeof config.thinking === "object",
      effort,
    },
    permissionMode: config.permissionMode,
  };
}

export async function setEffort(effort: string): Promise<void> {
  const config = await loadConfig();
  if (typeof config.thinking !== "object" || config.thinking === null) {
    config.thinking = {};
  }
  config.thinking.effort = effort as EffortLevel;
  cachedConfig = config;
  await fsPromises.writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

export async function setModel(modelSpec: string): Promise<void> {
  const config = await loadConfig();
  config.model = modelSpec;
  cachedConfig = config;
  await fsPromises.writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

export async function setTier(tier: string, modelSpec: string): Promise<void> {
  const config = await loadConfig();
  if (!config.tiers) config.tiers = {};
  config.tiers[tier] = modelSpec;
  cachedConfig = config;
  await fsPromises.writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}
