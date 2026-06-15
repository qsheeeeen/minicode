import { describe, it, expect, vi } from "vitest";
import { AppConfig } from "../config.js";
import { ModelSwitchService } from "./model-switcher.js";

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
  });
  const contextManager = {
    setModel: vi.fn(),
    getTokenCount: vi.fn().mockReturnValue(42),
  };
  const sessionManager = {
    saveStore: vi.fn().mockResolvedValue(undefined),
    reportStatus: vi.fn(),
  };
  const permissionService = {
    updateAutoGate: vi.fn(),
  };
  const setModel = vi.fn();
  vi.spyOn(appConfig, "setModel").mockResolvedValue();
  vi.spyOn(appConfig, "setTier").mockResolvedValue();

  const service = new ModelSwitchService({
    appConfig,
    contextManager: contextManager as any,
    sessionManager: sessionManager as any,
    setModel,
    permissionService: permissionService as any,
  });

  return {
    service,
    appConfig,
    contextManager,
    sessionManager,
    permissionService,
    setModel,
  };
}

describe("ModelSwitchService", () => {
  it("switches the active model and updates dependent runtime state", async () => {
    const {
      service,
      appConfig,
      contextManager,
      sessionManager,
      permissionService,
      setModel,
    } = createService();

    const selection = await service.switchAgentModel({
      modelSpec: "next-model@test",
    });
    const { client, model } = selection;

    expect(setModel).toHaveBeenCalledWith(client, model);
    expect(model.getName()).toBe("next-model");
    expect(contextManager.setModel).toHaveBeenCalledWith(client, model);
    expect(permissionService.updateAutoGate).toHaveBeenCalledWith(
      client,
      model,
    );
    expect(appConfig.setModel).toHaveBeenCalledWith("next-model@test");
    expect(sessionManager.saveStore).toHaveBeenCalledWith({
      model: "next-model",
      totalTokens: 42,
    });
    expect(sessionManager.reportStatus).toHaveBeenCalled();
  });

  it("can update a tier mapping while switching", async () => {
    const { service, appConfig } = createService();

    await service.switchAgentModel({
      modelSpec: "next-model@test",
      tier: "flash",
    });

    expect(appConfig.setTier).toHaveBeenCalledWith("flash", "next-model@test");
  });

  it("can avoid persisting the default model", async () => {
    const { service, appConfig } = createService();

    await service.switchAgentModel({
      modelSpec: "next-model@test",
      persistDefault: false,
    });

    expect(appConfig.setModel).not.toHaveBeenCalled();
  });

  it("throws when the model spec cannot be resolved", async () => {
    const { service } = createService();

    await expect(
      service.switchAgentModel({
        modelSpec: "missing@unknown",
      }),
    ).rejects.toThrow('Could not resolve "missing@unknown".');
  });
});
