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
      '{"model": "claude-sonnet-4-5@anthropic", "compressionThreshold": 0.9}',
    );
    const config = await loadConfig();
    expect(config.model).toBe("claude-sonnet-4-5@anthropic");
    expect(config.compressionThreshold).toBe(0.9);
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
      '{"model": "claude-sonnet-4-5@anthropic", "compressionThreshold": 0.9}',
    );
    const config = loadConfigSync();
    expect(config.model).toBe("claude-sonnet-4-5@anthropic");
    expect(config.compressionThreshold).toBe(0.9);
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
  });

  it("uses environment MODEL override", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        providers: { openai: { apiKey: "key" } },
        model: "gpt-4o@openai",
      }),
    );
    const config = await loadAllConfig();
    expect(config.model?.model).toBe("gpt-4o");
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
        tiers: { pro: "claude-sonnet@anthropic", flash: "gpt-4o@openai" },
      }),
    );
    const config = await loadConfig();
    expect(config.tiers).toEqual({
      pro: "claude-sonnet@anthropic",
      flash: "gpt-4o@openai",
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
    await setTier("pro", "claude-opus@anthropic");
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.stringContaining('"pro"'),
      "utf-8",
    );
  });
});
