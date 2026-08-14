import { describe, it, expect, vi } from "vitest";
import { modeHandlers, type ModeHandlerDeps } from "./mode-handlers.js";
import type { SessionManager } from "../../services/session-manager.js";

function makeDeps(overrides?: Partial<ModeHandlerDeps>): ModeHandlerDeps {
  return {
    model: {
      setEffort: vi.fn(),
    } as any,
    config: {
      setEffort: vi.fn(),
      tiers: { pro: "m@p", flash: "f@p" },
    } as any,
    modelSwitchService: {
      switchAgentModel: vi.fn().mockResolvedValue({
        ok: true,
        selection: {},
      }),
    } as any,
    sessionManager: {
      reportStatus: vi.fn(),
    } as unknown as SessionManager,
    handleSubmit: vi.fn(),
    ...overrides,
  };
}

describe("modeHandlers", () => {
  it("effort-select reports status through the session manager, not UI state", async () => {
    const deps = makeDeps();

    await modeHandlers["effort-select"]("high", deps);

    expect(deps.model.setEffort).toHaveBeenCalledWith("high");
    expect(deps.config.setEffort).toHaveBeenCalledWith("high");
    expect(deps.sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "status",
        content: "(Effort set to: high)",
      }),
    );
  });

  it("model-select reports switch failures through the session manager", async () => {
    const deps = makeDeps({
      modelSwitchService: {
        switchAgentModel: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'Could not resolve "x@y".',
        }),
      } as any,
    });

    await modeHandlers["model-select"]("pro:x@y", deps);

    expect(deps.sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "error",
        content: '(Error: Could not resolve "x@y".)',
      }),
    );
  });

  it("model-select with bare tier resolves from config and switches", async () => {
    const deps = makeDeps();

    await modeHandlers["model-select"]("pro:", deps);

    expect(deps.modelSwitchService.switchAgentModel).toHaveBeenCalledWith({
      modelSpec: "m@p",
      tier: undefined,
    });
  });

  it("session-list re-feeds the command layer", async () => {
    const deps = makeDeps();

    await modeHandlers["session-list"]("s-123", deps);

    expect(deps.handleSubmit).toHaveBeenCalledWith("/resume s-123");
  });
});
