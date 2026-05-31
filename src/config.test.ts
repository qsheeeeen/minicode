import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import {
  loadConfig,
  loadConfigSync,
  invalidateConfig,
  loadAllConfig,
  parseModelSpecifier,
  setTier,
} from "./config.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

describe("loadConfig", () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it("returns empty config when file does not exist", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ENOENT"),
    );
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  it("caches config after first load", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      '{"model": "test"}',
    );
    await loadConfig();
    await loadConfig();
    expect(fs.default.readFile).toHaveBeenCalledTimes(1);
  });

  it("refreshes cache when refresh=true", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      '{"model": "test"}',
    );
    await loadConfig();
    await loadConfig(true);
    expect(fs.default.readFile).toHaveBeenCalledTimes(2);
  });

  it("parses valid JSON config", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      '{"model": "glm-4.7@zhipu", "compressionThreshold": 0.9}',
    );
    const config = await loadConfig();
    expect(config.model).toBe("glm-4.7@zhipu");
    expect(config.compressionThreshold).toBe(0.9);
  });

  it("normalizes Viper lowercase keys to camelCase", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        compressionthreshold: 0.8,
        permissionmode: "yolo",
        promptfile: "CUSTOM.md",
        skillsdir: "skills",
        providers: {
          deepseek: {
            apikey: "sk-test",
            baseurl: "https://api.deepseek.com",
            models: { "deepseek-v4": { contextlength: 1000000 } },
          },
        },
      }),
    );
    const config = await loadConfig();
    expect(config.compressionThreshold).toBe(0.8);
    expect(config.permissionMode).toBe("yolo");
    expect(config.promptFile).toBe("CUSTOM.md");
    expect(config.skillsDir).toBe("skills");
    expect(config.providers?.deepseek?.apiKey).toBe("sk-test");
    expect(config.providers?.deepseek?.baseURL).toBe("https://api.deepseek.com");
    expect(config.providers?.deepseek?.models?.["deepseek-v4"]?.contextLength).toBe(1000000);
  });

  it("merges top-level provider into providers", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        providers: { deepseek: { apikey: "sk-d" } },
        zhipu: { apikey: "zk-z", baseurl: "https://zhipu.ai" },
      }),
    );
    const config = await loadConfig();
    expect(config.providers?.zhipu?.apiKey).toBe("zk-z");
    expect(config.providers?.deepseek?.apiKey).toBe("sk-d");
  });
});

describe("loadConfigSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty config when file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(loadConfigSync()).toEqual({});
  });

  it("parses valid JSON config", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"model": "glm-4.7@zhipu", "promptFile": "CUSTOM.md"}',
    );
    const config = loadConfigSync();
    expect(config.model).toBe("glm-4.7@zhipu");
    expect(config.promptFile).toBe("CUSTOM.md");
  });
});

describe("parseModelSpecifier", () => {
  it("parses model@provider format", () => {
    const result = parseModelSpecifier("claude-3@anthropic", {
      anthropic: { apiKey: "key" },
    });
    expect(result?.modelName).toBe("claude-3");
    expect(result?.providerName).toBe("anthropic");
  });

  it("falls back to first provider when no @provider", () => {
    const result = parseModelSpecifier("claude-3", {
      anthropic: { apiKey: "key" },
    });
    expect(result?.providerName).toBe("anthropic");
  });

  it("returns null when provider has no apiKey", () => {
    const result = parseModelSpecifier("claude-3@anthropic", { anthropic: {} });
    expect(result).toBeNull();
  });
});

describe("loadAllConfig", () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it("resolves full config with defaults", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        providers: { anthropic: { apiKey: "key" } },
        model: "claude-3@anthropic",
      }),
    );
    const config = await loadAllConfig();
    expect(config.model).toBeDefined();
    expect(config.model?.model).toBe("claude-3");
    expect(config.compressionThreshold).toBe(0.8);
    expect(config.thinking.enabled).toBe(false);
    expect(config.promptFile).toBe("AGENTS.md");
  });

  it("uses environment MODEL override", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        providers: { zhipu: { apiKey: "key" } },
        model: "glm@zhipu",
      }),
    );
    const originalModel = process.env.MODEL;
    process.env.MODEL = "glm-4@zhipu";
    const config = await loadAllConfig();
    if (originalModel !== undefined) {
      process.env.MODEL = originalModel;
    } else {
      delete process.env.MODEL;
    }
    expect(config.model?.model).toBe("glm-4");
  });
});

describe("tiers", () => {
  beforeEach(() => {
    invalidateConfig();
    vi.clearAllMocks();
  });

  it("parses tiers from config", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        tiers: { "1": "claude-sonnet@anthropic", "2": "glm-4.7@zhipu" },
      }),
    );
    const config = await loadConfig();
    expect(config.tiers).toEqual({
      "1": "claude-sonnet@anthropic",
      "2": "glm-4.7@zhipu",
    });
  });

  it("tiers is undefined when not in config", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("{}");
    const config = await loadConfig();
    expect(config.tiers).toBeUndefined();
  });

  it("setTier writes tier mapping", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("{}");
    await setTier("1", "claude-opus@anthropic");
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.stringContaining('"1"'),
      "utf-8",
    );
  });
});
