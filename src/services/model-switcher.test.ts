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
    setContextLength: vi.fn(),
    getTokenCount: vi.fn().mockReturnValue(42),
  };
  const sessionManager = {
    saveStore: vi.fn().mockResolvedValue(undefined),
    reportStatus: vi.fn(),
  };
  const permissionService = {
    updateAutoGate: vi.fn(),
  };
  vi.spyOn(appConfig, "setModel").mockResolvedValue();
  vi.spyOn(appConfig, "setTier").mockResolvedValue();

  const service = new ModelSwitchService({
    appConfig,
    contextManager: contextManager as any,
    sessionManager: sessionManager as any,
    permissionService: permissionService as any,
  });
  const agent = { model: undefined } as any;

  return {
    service,
    appConfig,
    contextManager,
    sessionManager,
    permissionService,
    agent,
  };
}

describe("ModelSwitchService", () => {
  it("switches the agent model and updates dependent runtime state", async () => {
    const {
      service,
      appConfig,
      contextManager,
      sessionManager,
      permissionService,
      agent,
    } = createService();

    const model = await service.switchAgentModel({
      agent,
      modelSpec: "next-model@test",
    });

    expect(agent.model).toBe(model);
    expect(model.getName()).toBe("next-model");
    expect(contextManager.setContextLength).toHaveBeenCalledWith(1234);
    expect(permissionService.updateAutoGate).toHaveBeenCalledWith(
      model.getClient(),
      "next-model",
    );
    expect(appConfig.setModel).toHaveBeenCalledWith("next-model@test");
    expect(sessionManager.saveStore).toHaveBeenCalledWith({
      model: "next-model",
      totalTokens: 42,
    });
    expect(sessionManager.reportStatus).toHaveBeenCalled();
  });

  it("can update a tier mapping while switching", async () => {
    const { service, appConfig, agent } = createService();

    await service.switchAgentModel({
      agent,
      modelSpec: "next-model@test",
      tier: "flash",
    });

    expect(appConfig.setTier).toHaveBeenCalledWith("flash", "next-model@test");
  });

  it("can avoid persisting the default model", async () => {
    const { service, appConfig, agent } = createService();

    await service.switchAgentModel({
      agent,
      modelSpec: "next-model@test",
      persistDefault: false,
    });

    expect(appConfig.setModel).not.toHaveBeenCalled();
  });

  it("throws when the model spec cannot be resolved", async () => {
    const { service, agent } = createService();

    await expect(
      service.switchAgentModel({
        agent,
        modelSpec: "missing@unknown",
      }),
    ).rejects.toThrow('Could not resolve "missing@unknown".');
  });
});
