import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppConfig, parseModelSpecifier, resolveModel } from "./config.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

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

describe("resolveModel", () => {
  it("resolves a spec into a flattened descriptor", () => {
    const m = resolveModel("claude-3@anthropic", {
      anthropic: {
        apiKey: "key",
        baseURL: "https://api",
        models: { "claude-3": { contextLength: 200000, name: "Claude 3" } },
      },
    });
    expect(m).toMatchObject({
      provider: "anthropic",
      protocol: "anthropic",
      model: "claude-3",
      apiKey: "key",
      baseURL: "https://api",
      contextLength: 200000,
      displayName: "Claude 3",
    });
  });

  it("returns null for unresolvable spec", () => {
    expect(resolveModel("x@unknown", {})).toBeNull();
  });
});

describe("AppConfig.load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty-based config when file is missing", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ENOENT"),
    );
    const config = await AppConfig.load();
    expect(config.model).toBeNull();
    expect(config.permissionMode).toBe("manual");
  });

  it("reads and resolves config from file", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        providers: { anthropic: { apiKey: "key" } },
        model: "claude-3@anthropic",
        compressionThreshold: 0.9,
      }),
    );
    const config = await AppConfig.load();
    expect(config.model?.model).toBe("claude-3");
    expect(config.compressionThreshold).toBe(0.9);
    // legacy top-level model migrated to tiers.pro
    expect(config.tiers.pro).toBe("claude-3@anthropic");
  });

  it("does not cache — each load re-reads", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("{}");
    await AppConfig.load();
    await AppConfig.load();
    expect(fs.default.readFile).toHaveBeenCalledTimes(2);
  });
});

describe("AppConfig getters", () => {
  it("applies defaults for empty raw config", () => {
    const config = new AppConfig({});
    expect(config.model).toBeNull();
    expect(config.providers).toEqual({});
    expect(config.compressionThreshold).toBe(0.8);
    expect(config.thinking.effort).toBeUndefined();
    expect(config.permissionMode).toBe("manual");
    expect(config.tiers).toEqual({});
    expect(config.activeTier).toBe("pro");
  });

  it("exposes providers, tiers, activeTier, modelSpec from raw", () => {
    const config = new AppConfig({
      providers: { anthropic: { apiKey: "key" } },
      tiers: { pro: "claude-3@anthropic", flash: "claude-haiku@anthropic" },
      activeTier: "flash",
    });
    expect(config.providers.anthropic?.apiKey).toBe("key");
    expect(config.activeTier).toBe("flash");
    expect(config.modelSpec).toBe("claude-haiku@anthropic");
    expect(config.model?.model).toBe("claude-haiku");
  });

  it("activeTier falls back when the preferred tier has no spec", () => {
    const config = new AppConfig({
      tiers: { flash: "claude-haiku@anthropic" },
      activeTier: "flash",
    });
    expect(config.activeTier).toBe("flash");

    const proPreferred = new AppConfig({
      tiers: { flash: "claude-haiku@anthropic" },
    });
    expect(proPreferred.activeTier).toBe("flash");
    expect(proPreferred.modelSpec).toBe("claude-haiku@anthropic");
  });

  it("activeTier treats invalid raw values as pro", () => {
    const config = new AppConfig({ activeTier: "garbage" });
    expect(config.activeTier).toBe("pro");
  });

  it("folds legacy top-level model into tiers.pro", () => {
    const raw = {
      providers: { anthropic: { apiKey: "key" } },
      model: "claude-3@anthropic",
    };
    const config = new AppConfig(raw);
    expect(config.tiers.pro).toBe("claude-3@anthropic");
    expect(config.modelSpec).toBe("claude-3@anthropic");
    expect(raw.model).toBeUndefined();
  });

  it("legacy model does not overwrite an existing tiers.pro", () => {
    const config = new AppConfig({
      providers: { anthropic: { apiKey: "key" } },
      model: "legacy@anthropic",
      tiers: { pro: "claude-3@anthropic" },
    });
    expect(config.tiers.pro).toBe("claude-3@anthropic");
  });

  it("model is null when the active spec cannot be resolved", () => {
    const config = new AppConfig({
      providers: {},
      tiers: { pro: "claude-3@nowhere" },
    });
    expect(config.model).toBeNull();
  });

  it("resolves legacy top-level effort into thinking", () => {
    const config = new AppConfig({ effort: "high" });
    expect(config.thinking.effort).toBe("high");
  });

  it("resolveModel resolves against current providers", () => {
    const config = new AppConfig({
      providers: { anthropic: { apiKey: "key" } },
    });
    expect(config.resolveModel("claude-3@anthropic")?.model).toBe("claude-3");
  });
});

describe("AppConfig mutators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setActiveTier updates in-memory state and persists", async () => {
    const fs = await import("fs/promises");
    const config = new AppConfig({
      tiers: { pro: "claude-3@anthropic", flash: "claude-haiku@anthropic" },
    });
    await config.setActiveTier("flash");
    expect(config.activeTier).toBe("flash");
    expect(config.modelSpec).toBe("claude-haiku@anthropic");
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"activeTier": "flash"'),
      "utf-8",
    );
  });

  it("setEffort updates thinking and persists", async () => {
    const fs = await import("fs/promises");
    const config = new AppConfig({});
    await config.setEffort("high");
    expect(config.thinking.effort).toBe("high");
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"effort"'),
      "utf-8",
    );
  });

  it("setTier updates tiers and persists", async () => {
    const fs = await import("fs/promises");
    const config = new AppConfig({});
    await config.setTier("pro", "claude-opus@anthropic");
    expect(config.tiers.pro).toBe("claude-opus@anthropic");
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"pro"'),
      "utf-8",
    );
  });
});
