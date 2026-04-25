import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, invalidateConfig, getProviderConfig, getApiKey, getModelConfig, getCompressionThreshold, getThinkingConfig, getPromptFile, loadAllConfig } from './config.js';

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('loadConfig', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('returns empty config when file does not exist', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  it('caches config after first load', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"model": "test"}');
    await loadConfig();
    await loadConfig();
    expect(fs.default.readFile).toHaveBeenCalledTimes(1);
  });

  it('refreshes cache when refresh=true', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"model": "test"}');
    await loadConfig();
    await loadConfig(true);
    expect(fs.default.readFile).toHaveBeenCalledTimes(2);
  });

  it('parses valid JSON config', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"model": "glm-4.7@zhipu", "compressionThreshold": 0.9}');
    const config = await loadConfig();
    expect(config.model).toBe('glm-4.7@zhipu');
    expect(config.compressionThreshold).toBe(0.9);
  });
});

describe('getProviderConfig', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('extracts provider from model specifier', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'key' } },
      model: 'claude-3@anthropic'
    }));
    const provider = await getProviderConfig();
    expect(provider).toBeDefined();
    expect(Object.keys(provider!)).toContain('apiKey');
  });

  it('falls back to first available provider', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { zhipu: { apiKey: 'key' } }
    }));
    const provider = await getProviderConfig();
    expect(provider?.apiKey).toBe('key');
  });

  it('returns undefined when no providers configured', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{}');
    const provider = await getProviderConfig();
    expect(provider).toBeUndefined();
  });
});

describe('getApiKey', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('returns apiKey for specified provider', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'test-key-123' } }
    }));
    const key = await getApiKey('anthropic');
    expect(key).toBe('test-key-123');
  });
});

describe('getModelConfig', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('parses model@provider format', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'key' } }
    }));
    const config = await getModelConfig('claude-3.5@anthropic');
    expect(config?.model).toBe('claude-3.5');
    expect(config?.provider).toBe('anthropic');
  });

  it('uses config.model when no specifier provided', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { zhipu: { apiKey: 'key' } },
      model: 'glm-4.7@zhipu'
    }));
    const config = await getModelConfig();
    expect(config?.model).toBe('glm-4.7');
    expect(config?.provider).toBe('zhipu');
  });

  it('returns null when no model specified', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{}');
    const config = await getModelConfig();
    expect(config).toBeNull();
  });

  it('returns null when provider has no apiKey', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: {} }
    }));
    const config = await getModelConfig('claude-3@anthropic');
    expect(config).toBeNull();
  });

  it('includes baseURL when configured', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'key', baseURL: 'https://custom.example.com' } }
    }));
    const config = await getModelConfig('claude-3@anthropic');
    expect(config?.baseURL).toBe('https://custom.example.com');
  });

  it('includes contextLength from model config', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'key', models: { 'claude-3': { contextLength: 200000 } } } }
    }));
    const config = await getModelConfig('claude-3@anthropic');
    expect(config?.contextLength).toBe(200000);
  });
});

describe('getCompressionThreshold', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('returns configured value', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"compressionThreshold": 0.9}');
    const threshold = await getCompressionThreshold();
    expect(threshold).toBe(0.9);
  });

  it('defaults to 0.8', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{}');
    const threshold = await getCompressionThreshold();
    expect(threshold).toBe(0.8);
  });
});

describe('getThinkingConfig', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('returns configured thinking settings', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"thinking": true, "effort": "low"}');
    const config = await getThinkingConfig();
    expect(config.enabled).toBe(true);
    expect(config.effort).toBe("low");
  });

  it('defaults thinking to disabled', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{}');
    const config = await getThinkingConfig();
    expect(config.enabled).toBe(false);
    expect(config.effort).toBeUndefined();
  });
});

describe('getPromptFile', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('returns configured prompt file', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{"promptFile": "PROMPT.md"}');
    const file = await getPromptFile();
    expect(file).toBe('PROMPT.md');
  });

  it('defaults to MINICODE.md', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('{}');
    const file = await getPromptFile();
    expect(file).toBe('MINICODE.md');
  });
});

describe('loadAllConfig', () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it('resolves full config with defaults', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { anthropic: { apiKey: 'key' } },
      model: 'claude-3@anthropic'
    }));
    const config = await loadAllConfig();
    expect(config.model).toBeDefined();
    expect(config.model?.model).toBe('claude-3');
    expect(config.compressionThreshold).toBe(0.8);
    expect(config.thinking.enabled).toBe(false);
    expect(config.promptFile).toBe('MINICODE.md');
  });

  it('uses environment MODEL override', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      providers: { zhipu: { apiKey: 'key' } },
      model: 'glm@zhipu'
    }));
    const originalModel = process.env.MODEL;
    process.env.MODEL = 'glm-4@zhipu';
    const config = await loadAllConfig();
    if (originalModel !== undefined) {
      process.env.MODEL = originalModel;
    } else {
      delete process.env.MODEL;
    }
    expect(config.model?.model).toBe('glm-4');
  });
});
