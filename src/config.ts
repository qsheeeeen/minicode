import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface Providers {
  anthropic?: ProviderConfig;
  zhipu?: ProviderConfig;
  [key: string]: ProviderConfig | undefined;
}

export interface Config {
  providers?: Providers;
  defaultProvider?: string;
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
  const providerName = provider || config.defaultProvider || 'anthropic';
  return config.providers?.[providerName];
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
