import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.minicode');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface ModelConfig {
  contextLength?: number;
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

export interface Config {
  providers?: Providers;
  model?: string;  // format: model@provider, e.g. "glm-4.7@zhipu"
  compressionThreshold?: number;  // 0-1, compress at this ratio of context
  thinking?: boolean;  // enable extended thinking
  thinkingTokens?: number;  // tokens budget for thinking (default 20000)
  promptFile?: string;  // project prompt filename (default: MINICODE.md)
}

let cachedConfig: Config | null = null;

export async function loadConfig(refresh = false): Promise<Config> {
  if (cachedConfig && !refresh) return cachedConfig;

  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
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

export async function getProviderConfig(provider?: string): Promise<ProviderConfig | undefined> {
  const config = await loadConfig();
  if (!provider) {
    // Try to extract provider from model config
    const spec = config.model;
    if (spec) {
      const parts = spec.split('@');
      provider = parts[1] || Object.keys(config.providers || {})[0];
    } else {
      provider = Object.keys(config.providers || {})[0];
    }
  }
  return config.providers?.[provider];
}

export async function getApiKey(provider?: string): Promise<string | undefined> {
  const providerConfig = await getProviderConfig(provider);
  return providerConfig?.apiKey;
}

export async function getBaseURL(provider?: string): Promise<string | undefined> {
  const providerConfig = await getProviderConfig(provider);
  return providerConfig?.baseURL;
}

export async function getModelConfig(modelSpecifier?: string): Promise<{ provider: string; model: string; apiKey: string; baseURL?: string; contextLength?: number } | null> {
  const config = await loadConfig();
  const spec = modelSpecifier || config.model;

  if (!spec) return null;

  // Parse "model@provider" or just "model"
  const parts = spec.split('@');
  const modelName = parts[0];
  const providerName = parts[1] || Object.keys(config.providers || {})[0];

  const providerConfig = config.providers?.[providerName];
  if (!providerConfig?.apiKey) return null;

  // Resolve contextLength from per-model config
  const modelConfig = providerConfig.models?.[modelName];
  const contextLength = modelConfig?.contextLength;

  return {
    provider: providerName,
    model: modelName,
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    contextLength
  };
}

export async function getCompressionThreshold(): Promise<number> {
  const config = await loadConfig();
  return config.compressionThreshold ?? 0.8;
}

export async function getThinkingConfig(): Promise<{ enabled: boolean; tokens: number }> {
  const config = await loadConfig();
  return {
    enabled: config.thinking ?? false,
    tokens: config.thinkingTokens ?? 20000
  };
}

export async function getPromptFile(): Promise<string> {
  const config = await loadConfig();
  return config.promptFile || 'MINICODE.md';
}

export interface ResolvedConfig {
  model: { provider: string; model: string; apiKey: string; baseURL?: string; contextLength?: number } | null;
  compressionThreshold: number;
  thinking: { enabled: boolean; tokens: number };
  promptFile: string;
}

export async function loadAllConfig(modelSpecifier?: string): Promise<ResolvedConfig> {
  const config = await loadConfig();
  const spec = modelSpecifier || process.env.MODEL || config.model;

  let model: ResolvedConfig['model'] = null;
  if (spec) {
    const parts = spec.split('@');
    const modelName = parts[0];
    const providerName = parts[1] || Object.keys(config.providers || {})[0];
    const providerConfig = config.providers?.[providerName];
    if (providerConfig?.apiKey) {
      const modelConfig = providerConfig.models?.[modelName];
      model = {
        provider: providerName,
        model: modelName,
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        contextLength: modelConfig?.contextLength
      };
    }
  }

  return {
    model,
    compressionThreshold: config.compressionThreshold ?? 0.8,
    thinking: {
      enabled: config.thinking ?? false,
      tokens: config.thinkingTokens ?? 20000
    },
    promptFile: config.promptFile || 'MINICODE.md'
  };
}
