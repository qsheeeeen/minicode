import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  contextLength?: number;
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
}

const CONFIG_PATH = path.join(__dirname, '../config.json');

let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig;

  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(content) as Config;
    return cachedConfig ?? {};
  } catch {
    // 配置文件不存在，返回空配置
    return {};
  }
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

export async function getModel(provider?: string): Promise<string | undefined> {
  const providerConfig = await getProviderConfig(provider);
  return providerConfig?.model;
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

  return {
    provider: providerName,
    model: modelName,
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    contextLength: providerConfig.contextLength
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
