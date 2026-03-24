import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  anthropicApiKey?: string;
  baseURL?: string;
  model?: string;
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

export async function getApiKey(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.anthropicApiKey;
}
