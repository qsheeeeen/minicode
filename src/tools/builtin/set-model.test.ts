import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppConfig } from "../../config.js";
import { setModelTool } from "./set-model.js";

function makeContext(
  appConfig: AppConfig,
  overrides?: Record<string, unknown>,
) {
  return {
    registry: undefined,
    config: {} as any,
    appConfig,
    currentAgentId: "1",
    signal: undefined,
    services: {
      modelSwitcher: {
        switchAgentModel: vi.fn().mockResolvedValue({ getName: () => "model" }),
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setModelTool", () => {
  it("switches model for a valid tier through ModelSwitchService", async () => {
    const appConfig = new AppConfig({
      tiers: { pro: "claude-sonnet-4-5@anthropic" },
    });
    const context = makeContext(appConfig);

    const result = await setModelTool.execute({ tier: "pro" }, context);

    expect(result.output).toBe("Switched to pro: claude-sonnet-4-5@anthropic");
    expect(
      context.services.modelSwitcher.switchAgentModel,
    ).toHaveBeenCalledWith({
      modelSpec: "claude-sonnet-4-5@anthropic",
      persistDefault: true,
      reportStatus: false,
    });
  });

  it("returns error when tier is not mapped", async () => {
    const appConfig = new AppConfig({ tiers: { flash: "gpt-4o-mini@openai" } });
    const context = makeContext(appConfig);

    const result = await setModelTool.execute({ tier: "pro" }, context);

    expect(result.output).toBe("Error: No model mapped to tier pro.");
    expect(
      context.services.modelSwitcher.switchAgentModel,
    ).not.toHaveBeenCalled();
  });

  it("returns error when model specifier cannot be resolved", async () => {
    const appConfig = new AppConfig({
      tiers: { pro: "deepseek-chat@deepseek" },
    });
    const context = makeContext(appConfig);
    context.services.modelSwitcher.switchAgentModel.mockRejectedValue(
      new Error("Could not resolve"),
    );

    const result = await setModelTool.execute({ tier: "pro" }, context);

    expect(result.output).toBe(
      'Error: Could not resolve "deepseek-chat@deepseek" for tier pro.',
    );
  });

  it("returns error when model switch service is unavailable", async () => {
    const appConfig = new AppConfig({ tiers: { flash: "gpt-4o-mini@openai" } });

    const result = await setModelTool.execute(
      { tier: "flash" },
      makeContext(appConfig, { services: undefined }),
    );

    expect(result.output).toBe("Error: model switch service not available.");
  });

  it("does not persist sub-agent model switches as the default", async () => {
    const appConfig = new AppConfig({ tiers: { flash: "gpt-4o-mini@openai" } });
    const context = makeContext(appConfig, { currentAgentId: "2" });

    await setModelTool.execute({ tier: "flash" }, context);

    expect(
      context.services.modelSwitcher.switchAgentModel,
    ).toHaveBeenCalledWith({
      modelSpec: "gpt-4o-mini@openai",
      persistDefault: false,
      reportStatus: false,
    });
  });
});
