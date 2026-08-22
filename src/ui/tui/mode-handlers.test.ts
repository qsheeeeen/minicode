import { describe, it, expect, vi } from "vitest";
import { getInputModeHandler } from "./input-modes.js";
import type { ModeHandlerDeps } from "./mode-handlers.js";
import type { SessionManager } from "../../services/session-manager.js";

function makeDeps(overrides?: Partial<ModeHandlerDeps>): ModeHandlerDeps {
  return {
    model: {
      setEffort: vi.fn(),
    } as any,
    config: {
      setEffort: vi.fn(),
    } as any,
    modelSwitchService: {
      switchTier: vi.fn().mockResolvedValue({ ok: true, spec: "m@p" }),
      remapTier: vi.fn().mockResolvedValue({ ok: true, spec: "m@p" }),
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

    await getInputModeHandler("effort-select")!("high", deps);

    expect(deps.model.setEffort).toHaveBeenCalledWith("high");
    expect(deps.config.setEffort).toHaveBeenCalledWith("high");
    expect(deps.sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "status",
        content: "(Effort set to: high)",
      }),
    );
  });

  it("model-select reports remap failures through the session manager", async () => {
    const deps = makeDeps({
      modelSwitchService: {
        switchTier: vi.fn(),
        remapTier: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'Could not resolve "x@y".',
        }),
      } as any,
    });

    await getInputModeHandler("model-select")!("pro:x@y", deps);

    expect(deps.sessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "error",
        content: '(Error: Could not resolve "x@y".)',
      }),
    );
  });

  it("model-select with a bare tier switches to it", async () => {
    const deps = makeDeps();

    await getInputModeHandler("model-select")!("pro:", deps);

    expect(deps.modelSwitchService.switchTier).toHaveBeenCalledWith("pro");
    expect(deps.modelSwitchService.remapTier).not.toHaveBeenCalled();
  });

  it("model-select with tier:spec remaps the tier", async () => {
    const deps = makeDeps();

    await getInputModeHandler("model-select")!("flash:x@y", deps);

    expect(deps.modelSwitchService.remapTier).toHaveBeenCalledWith(
      "flash",
      "x@y",
    );
    expect(deps.modelSwitchService.switchTier).not.toHaveBeenCalled();
  });

  it("session-list re-feeds the command layer", async () => {
    const deps = makeDeps();

    await getInputModeHandler("session-list")!("s-123", deps);

    expect(deps.handleSubmit).toHaveBeenCalledWith("/resume s-123");
  });
});
