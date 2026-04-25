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
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';  // reasoning effort level
  promptFile?: string;  // project prompt filename (default: MINICODE.md)
  permissionMode?: 'manual' | 'yolo' | 'auto';  // default permission mode
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

function parseModelSpecifier(
  spec: string,
  providers: Providers
): { modelName: string; providerName: string; providerConfig: ProviderConfig } | null {
  const parts = spec.split('@');
  const modelName = parts[0];
  const providerName = parts[1] || Object.keys(providers || {})[0];
  const providerConfig = providers?.[providerName];
  if (!providerConfig?.apiKey) return null;
  return { modelName, providerName, providerConfig };
}

export async function getModelConfig(modelSpecifier?: string): Promise<{ provider: string; model: string; apiKey: string; baseURL?: string; contextLength?: number } | null> {
  const config = await loadConfig();
  const spec = modelSpecifier || config.model;
  if (!spec) return null;

  const parsed = parseModelSpecifier(spec, config.providers ?? {});
  if (!parsed) return null;

  const modelConfig = parsed.providerConfig.models?.[parsed.modelName];
  return {
    provider: parsed.providerName,
    model: parsed.modelName,
    apiKey: parsed.providerConfig.apiKey!,
    baseURL: parsed.providerConfig.baseURL,
    contextLength: modelConfig?.contextLength
  };
}

export async function getCompressionThreshold(): Promise<number> {
  const config = await loadConfig();
  return config.compressionThreshold ?? 0.8;
}

export async function getThinkingConfig(): Promise<{ enabled: boolean; effort?: string }> {
  const config = await loadConfig();
  return {
    enabled: config.thinking ?? false,
    effort: config.effort
  };
}

export async function getPromptFile(): Promise<string> {
  const config = await loadConfig();
  return config.promptFile || 'MINICODE.md';
}

export interface ResolvedConfig {
  model: { provider: string; model: string; apiKey: string; baseURL?: string; contextLength?: number } | null;
  compressionThreshold: number;
  thinking: { enabled: boolean; effort?: string };
  promptFile: string;
  permissionMode?: 'manual' | 'yolo' | 'auto';
}

export async function loadAllConfig(modelSpecifier?: string): Promise<ResolvedConfig> {
  const config = await loadConfig();
  const spec = modelSpecifier || process.env.MODEL || config.model;

  let model: ResolvedConfig['model'] = null;
  if (spec) {
    const parsed = parseModelSpecifier(spec, config.providers ?? {});
    if (parsed) {
      const modelConfig = parsed.providerConfig.models?.[parsed.modelName];
      model = {
        provider: parsed.providerName,
        model: parsed.modelName,
        apiKey: parsed.providerConfig.apiKey!,
        baseURL: parsed.providerConfig.baseURL,
        contextLength: modelConfig?.contextLength
      };
    }
  }

  return {
    model,
    compressionThreshold: config.compressionThreshold ?? 0.8,
    thinking: {
      enabled: config.thinking ?? false,
      effort: config.effort
    },
    promptFile: config.promptFile || 'MINICODE.md',
    permissionMode: config.permissionMode
  };
}
