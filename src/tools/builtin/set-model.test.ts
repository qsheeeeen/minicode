import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppConfig } from "../../config.js";

const mockFromSpec = vi.fn();

vi.mock("../../llm/model.js", () => ({
  ModelFactory: vi.fn().mockImplementation(function () {
    return { fromSpec: mockFromSpec };
  }),
}));

import { setModelTool } from "./set-model.js";

const mockAgent = { model: undefined as any };

function makeContext(appConfig: AppConfig, overrides?: Record<string, unknown>) {
  return {
    registry: {
      get: vi.fn().mockReturnValue({ agent: mockAgent }),
    },
    config: {} as any,
    appConfig,
    currentAgentId: "1",
    signal: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgent.model = undefined;
});

describe("setModelTool", () => {
  it("switches model for a valid tier", async () => {
    const mockModel = { getName: () => "claude-sonnet-4-5" };
    mockFromSpec.mockReturnValue(mockModel);
    const appConfig = new AppConfig({
      tiers: { pro: "claude-sonnet-4-5@anthropic" },
    });
    const setModelSpy = vi.spyOn(appConfig, "setModel").mockResolvedValue();

    const result = await setModelTool.execute({ tier: "pro" }, makeContext(appConfig));

    expect(result.output).toBe("Switched to pro: claude-sonnet-4-5@anthropic");
    expect(mockFromSpec).toHaveBeenCalledWith("claude-sonnet-4-5@anthropic");
    expect(mockAgent.model).toBe(mockModel);
    expect(setModelSpy).toHaveBeenCalledWith("claude-sonnet-4-5@anthropic");
  });

  it("returns error when tier is not mapped", async () => {
    const appConfig = new AppConfig({ tiers: { flash: "gpt-4o-mini@openai" } });
    const setModelSpy = vi.spyOn(appConfig, "setModel").mockResolvedValue();

    const result = await setModelTool.execute(
      { tier: "pro" },
      makeContext(appConfig),
    );

    expect(result.output).toBe("Error: No model mapped to tier pro.");
    expect(mockAgent.model).toBeUndefined();
    expect(setModelSpy).not.toHaveBeenCalled();
  });

  it("returns error when model specifier cannot be resolved", async () => {
    mockFromSpec.mockReturnValue(null);
    const appConfig = new AppConfig({
      tiers: { pro: "deepseek-chat@deepseek" },
    });
    const setModelSpy = vi.spyOn(appConfig, "setModel").mockResolvedValue();

    const result = await setModelTool.execute({ tier: "pro" }, makeContext(appConfig));

    expect(result.output).toBe(
      'Error: Could not resolve "deepseek-chat@deepseek" for tier pro.',
    );
    expect(mockAgent.model).toBeUndefined();
    expect(setModelSpy).not.toHaveBeenCalled();
  });

  it("works without agent in context", async () => {
    mockFromSpec.mockReturnValue({ getName: () => "gpt-4o-mini" });
    const appConfig = new AppConfig({ tiers: { flash: "gpt-4o-mini@openai" } });
    const setModelSpy = vi.spyOn(appConfig, "setModel").mockResolvedValue();

    const result = await setModelTool.execute(
      { tier: "flash" },
      makeContext(appConfig, { registry: undefined }),
    );

    expect(result.output).toBe("Switched to flash: gpt-4o-mini@openai");
    expect(mockAgent.model).toBeUndefined();
    expect(setModelSpy).toHaveBeenCalledWith("gpt-4o-mini@openai");
  });

  it("passes contextLength and displayName from provider config", async () => {
    const mockModel = {
      getName: () => "claude-opus",
      getContextLength: () => 200000,
      getDisplayName: () => "Claude Opus",
    };
    mockFromSpec.mockReturnValue(mockModel);
    const appConfig = new AppConfig({ tiers: { pro: "claude-opus@anthropic" } });
    vi.spyOn(appConfig, "setModel").mockResolvedValue();

    const result = await setModelTool.execute({ tier: "pro" }, makeContext(appConfig));

    expect(result.output).toBe("Switched to pro: claude-opus@anthropic");
    expect(mockFromSpec).toHaveBeenCalledWith("claude-opus@anthropic");
    expect(mockAgent.model).toBe(mockModel);
  });
});
