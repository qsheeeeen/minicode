import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock("../agent.js", () => ({
  runAgent: mockRun,
}));

const mockOnChange = vi.fn().mockReturnValue(() => {});
const mockSubscribe = vi.fn().mockReturnValue(() => {});

const mockContext = {
  onChange: mockOnChange,
  getUserMessageCount: vi.fn().mockReturnValue(0),
};

const mockSessionManager = {
  getContext: vi.fn().mockReturnValue(mockContext),
  setSession: vi.fn(),
  reportStatus: vi.fn(),
};

const mockContextManager = {
  setTokenCount: vi.fn(),
};

const mockRuntimeEvents = {
  subscribe: mockSubscribe,
};

const mockDeps = {
  client: {},
  model: { getName: () => "test" },
  sessionManager: mockSessionManager,
  contextManager: mockContextManager,
  toolExecutor: {},
  promptManager: {},
} as any;

import { runHeadless } from "./headless.js";

describe("runHeadless", () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it("calls runAgent with prompter that returns empty string", async () => {
    mockRun.mockResolvedValueOnce(true);
    await runHeadless(mockDeps, "test prompt", mockRuntimeEvents as any);

    expect(mockRun).toHaveBeenCalledWith(
      mockDeps,
      "test prompt",
      expect.any(AbortSignal),
      { prompter: expect.objectContaining({ prompt: expect.any(Function) }) },
    );

    // Verify the headless prompter always returns empty string
    const runOpts = mockRun.mock.calls[0][3];
    const result = await runOpts.prompter.prompt({
      message: "msg",
      options: [{ label: "Yes", value: "yes" }],
    });
    expect(result).toBe("");
  });

  it("calls runAgent with initial prompt", async () => {
    mockRun.mockResolvedValueOnce(true);
    await runHeadless(mockDeps, "test prompt", mockRuntimeEvents as any);
    expect(mockRun).toHaveBeenCalledWith(
      mockDeps,
      "test prompt",
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it("handles Aborted error", async () => {
    mockRun.mockRejectedValueOnce(new Error("Aborted"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runHeadless(mockDeps, "test prompt", mockRuntimeEvents as any);
    expect(logSpy).toHaveBeenCalledWith("(Aborted)");
    logSpy.mockRestore();
  });

  it("handles generic error", async () => {
    mockRun.mockRejectedValueOnce(new Error("test error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runHeadless(mockDeps, "test prompt", mockRuntimeEvents as any);
    expect(errSpy).toHaveBeenCalledWith("(Error: test error)");
    errSpy.mockRestore();
  });

  it("throws non-Error objects", async () => {
    mockRun.mockRejectedValueOnce("string error");
    await expect(
      runHeadless(mockDeps, "test prompt", mockRuntimeEvents as any),
    ).rejects.toBe("string error");
  });
});
