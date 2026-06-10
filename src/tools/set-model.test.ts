import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoadConfig = vi.fn();
const mockSetModel = vi.fn();
const mockFromSpec = vi.fn();

vi.mock("../config.js", () => ({
  loadConfig: mockLoadConfig,
  setModel: mockSetModel,
}));

vi.mock("../llm/model.js", () => ({
  ModelFactory: vi.fn().mockImplementation(function () {
    return { fromSpec: mockFromSpec };
  }),
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
    const mockModel = { getName: () => "claude-sonnet-4-5" };
    mockLoadConfig.mockResolvedValue({
      tiers: { pro: "claude-sonnet-4-5@anthropic" },
      providers: { anthropic: { apiKey: "sk-test" } },
    });
    mockFromSpec.mockReturnValue(mockModel);

    const result = await setModelTool.execute({ tier: "pro" }, makeContext());

    expect(result.output).toBe("Switched to pro: claude-sonnet-4-5@anthropic");
    expect(mockFromSpec).toHaveBeenCalledWith("claude-sonnet-4-5@anthropic");
    expect(mockSetModelOnAgent).toHaveBeenCalledWith(mockModel);
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
    mockFromSpec.mockReturnValue(null);

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
    mockFromSpec.mockReturnValue({ getName: () => "gpt-4o-mini" });

    const result = await setModelTool.execute(
      { tier: "flash" },
      makeContext({ registry: undefined }),
    );

    expect(result.output).toBe("Switched to flash: gpt-4o-mini@openai");
    expect(mockSetModelOnAgent).not.toHaveBeenCalled();
    expect(mockSetModel).toHaveBeenCalledWith("gpt-4o-mini@openai");
  });

  it("passes contextLength and displayName from provider config", async () => {
    const mockModel = {
      getName: () => "claude-opus",
      getContextLength: () => 200000,
      getDisplayName: () => "Claude Opus",
    };
    mockLoadConfig.mockResolvedValue({
      tiers: { pro: "claude-opus@anthropic" },
      providers: {},
    });
    mockFromSpec.mockReturnValue(mockModel);

    const result = await setModelTool.execute({ tier: "pro" }, makeContext());

    expect(result.output).toBe("Switched to pro: claude-opus@anthropic");
    expect(mockFromSpec).toHaveBeenCalledWith("claude-opus@anthropic");
    expect(mockSetModelOnAgent).toHaveBeenCalledWith(mockModel);
  });
});
