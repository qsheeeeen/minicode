import { describe, it, expect, vi } from "vitest";
import { AppConfig } from "../config.js";
import { ModelSwitchService } from "./model-switcher.js";
import { registerBuiltinProtocols } from "../llm/protocols/index.js";

registerBuiltinProtocols();

function createService() {
  const appConfig = new AppConfig({
    providers: {
      test: {
        apiKey: "test-key",
        protocol: "anthropic",
        models: {
          "next-model": { contextLength: 1234, name: "Next Model" },
        },
      },
    },
    tiers: { pro: "test-model@test", flash: "next-model@test" },
  });
  const contextManager = {
    setModel: vi.fn(),
    getTokenCount: vi.fn().mockReturnValue(42),
  };
  const sessionManager = {
    saveStore: vi.fn().mockResolvedValue(undefined),
    reportStatus: vi.fn(),
  };
  const runtimeState = {
    setClientModel: vi.fn(),
  };
  vi.spyOn(appConfig, "setActiveTier").mockResolvedValue();
  vi.spyOn(appConfig, "setTier").mockResolvedValue();

  const service = new ModelSwitchService({
    appConfig,
    contextManager: contextManager as any,
    sessionManager: sessionManager as any,
    runtimeState: runtimeState as any,
  });

  return {
    service,
    appConfig,
    contextManager,
    sessionManager,
    runtimeState,
  };
}

describe("ModelSwitchService", () => {
  it("switches tiers through the single RuntimeState handle", async () => {
    const { service, appConfig, sessionManager, runtimeState } =
      createService();

    const outcome = await service.switchTier("flash");
    expect(outcome).toEqual({ ok: true, spec: "next-model@test" });

    expect(appConfig.setActiveTier).toHaveBeenCalledWith("flash");
    expect(runtimeState.setClientModel).toHaveBeenCalledTimes(1);
    expect(runtimeState.setClientModel.mock.calls[0][1].getName()).toBe(
      "next-model",
    );
    expect(sessionManager.saveStore).toHaveBeenCalledWith({
      model: "next-model",
      totalTokens: 42,
    });
    expect(sessionManager.reportStatus).toHaveBeenCalled();
  });

  it("fails without persisting when the tier has no mapping", async () => {
    const { service, appConfig, runtimeState } = createService();
    appConfig.tiers.pro = undefined;

    const outcome = await service.switchTier("pro");

    expect(outcome.ok).toBe(false);
    expect(appConfig.setActiveTier).not.toHaveBeenCalled();
    expect(runtimeState.setClientModel).not.toHaveBeenCalled();
  });

  it("remaps a tier and hot-swaps when it is the active one", async () => {
    const { service, appConfig, sessionManager, runtimeState } =
      createService();

    const outcome = await service.remapTier("pro", "next-model@test");
    expect(outcome).toEqual({ ok: true, spec: "next-model@test" });

    expect(appConfig.setTier).toHaveBeenCalledWith("pro", "next-model@test");
    expect(runtimeState.setClientModel).toHaveBeenCalledTimes(1);
    expect(sessionManager.saveStore).toHaveBeenCalledWith({
      model: "next-model",
      totalTokens: 42,
    });
  });

  it("remaps an inactive tier without touching the live model", async () => {
    const { service, appConfig, sessionManager, runtimeState } =
      createService();

    await service.remapTier("flash", "next-model@test");

    expect(appConfig.setTier).toHaveBeenCalledWith("flash", "next-model@test");
    expect(runtimeState.setClientModel).not.toHaveBeenCalled();
    expect(sessionManager.saveStore).not.toHaveBeenCalled();
    expect(sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("flash tier set to"),
      }),
    );
  });

  it("returns a failure value when the model spec cannot be resolved", async () => {
    const { service, appConfig } = createService();

    const outcome = await service.remapTier("pro", "missing@unknown");

    expect(outcome).toEqual({
      ok: false,
      reason: 'Could not resolve "missing@unknown".',
    });
    expect(appConfig.setTier).not.toHaveBeenCalled();
  });
});
