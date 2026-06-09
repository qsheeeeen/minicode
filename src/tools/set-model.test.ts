import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoadConfig = vi.fn();
const mockParseModelSpecifier = vi.fn();
const mockSetModel = vi.fn();

vi.mock("../config.js", () => ({
  loadConfig: mockLoadConfig,
  parseModelSpecifier: mockParseModelSpecifier,
  setModel: mockSetModel,
}));

import { setModelTool } from "./set-model.js";

const mockSetModelOnAgent = vi.fn();
const mockAgent = { setModel: mockSetModelOnAgent };

function makeContext(overrides?: Record<string, unknown>) {
  return {
    registry: {
      get: vi.fn().mockReturnValue({ agent: mockAgent }),
    },
    config: {} as any,
    currentAgentId: "1",
    signal: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetModel.mockResolvedValue(undefined);
});

describe("setModelTool", () => {
  it("switches model for a valid tier", async () => {
    mockLoadConfig.mockResolvedValue({
      tiers: { pro: "claude-sonnet-4-5@anthropic" },
      providers: { anthropic: { apiKey: "sk-test" } },
    });
    mockParseModelSpecifier.mockReturnValue({
      modelName: "claude-sonnet-4-5",
      providerName: "anthropic",
      providerConfig: { apiKey: "sk-test" },
    });

    const result = await setModelTool.execute({ tier: "pro" }, makeContext());

    expect(result.output).toBe("Switched to pro: claude-sonnet-4-5@anthropic");
    expect(mockSetModelOnAgent).toHaveBeenCalledWith(
      "claude-sonnet-4-5",
      "sk-test",
      undefined,
      "anthropic",
      undefined,
      undefined,
    );
    expect(mockSetModel).toHaveBeenCalledWith("claude-sonnet-4-5@anthropic");
  });

  it("returns error when tier is not mapped", async () => {
    mockLoadConfig.mockResolvedValue({
      tiers: { flash: "gpt-4o-mini@openai" },
      providers: {},
    });

    const result = await setModelTool.execute(
      { tier: "pro" },
      makeContext(),
    );

    expect(result.output).toBe("Error: No model mapped to tier pro.");
    expect(mockSetModelOnAgent).not.toHaveBeenCalled();
    expect(mockSetModel).not.toHaveBeenCalled();
  });

  it("returns error when model specifier cannot be resolved", async () => {
    mockLoadConfig.mockResolvedValue({
      tiers: { pro: "deepseek-chat@deepseek" },
      providers: { deepseek: {} },
    });
    mockParseModelSpecifier.mockReturnValue(null);

    const result = await setModelTool.execute({ tier: "pro" }, makeContext());

    expect(result.output).toBe(
      'Error: Could not resolve "deepseek-chat@deepseek" for tier pro.',
    );
    expect(mockSetModelOnAgent).not.toHaveBeenCalled();
    expect(mockSetModel).not.toHaveBeenCalled();
  });

  it("works without agent in context", async () => {
    mockLoadConfig.mockResolvedValue({
      tiers: { flash: "gpt-4o-mini@openai" },
      providers: { openai: { apiKey: "oai-key" } },
    });
    mockParseModelSpecifier.mockReturnValue({
      modelName: "gpt-4o-mini",
      providerName: "openai",
      providerConfig: { apiKey: "oai-key", baseURL: "https://api.openai.com" },
    });

    const result = await setModelTool.execute(
      { tier: "flash" },
      makeContext({ registry: undefined }),
    );

    expect(result.output).toBe("Switched to flash: gpt-4o-mini@openai");
    expect(mockSetModelOnAgent).not.toHaveBeenCalled();
    expect(mockSetModel).toHaveBeenCalledWith("gpt-4o-mini@openai");
  });

  it("passes contextLength and displayName from provider config", async () => {
    mockLoadConfig.mockResolvedValue({
      tiers: { pro: "claude-opus@anthropic" },
      providers: {},
    });
    mockParseModelSpecifier.mockReturnValue({
      modelName: "claude-opus",
      providerName: "anthropic",
      providerConfig: {
        apiKey: "sk-test",
        models: {
          "claude-opus": { contextLength: 200000, name: "Claude Opus" },
        },
      },
    });

    const result = await setModelTool.execute({ tier: "pro" }, makeContext());

    expect(result.output).toBe("Switched to pro: claude-opus@anthropic");
    expect(mockSetModelOnAgent).toHaveBeenCalledWith(
      "claude-opus",
      "sk-test",
      undefined,
      "anthropic",
      200000,
      "Claude Opus",
    );
  });
});
