import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRun = vi.fn();
const mockOnChange = vi.fn().mockReturnValue(() => {});
const mockSubscribe = vi.fn().mockReturnValue(() => {});

const mockContext = {
  onChange: mockOnChange,
  getUserMessageCount: vi.fn().mockReturnValue(0),
};

const mockSetSession = vi.fn();
const mockSessionManager = {
  getContext: vi.fn().mockReturnValue(mockContext),
  setSession: mockSetSession,
  reportStatus: vi.fn(),
};

const mockTokenCount$ = {
  get: vi.fn().mockReturnValue(0),
  set: vi.fn(),
  subscribe: vi.fn().mockReturnValue(() => {}),
};

const mockAgent = {
  run: mockRun,
  model: undefined as any,
  logger: undefined as any,
};

const mockRuntimeEvents = {
  subscribe: mockSubscribe,
};

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

  it("calls agent.run with prompter that returns empty string", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(
      mockAgent as any,
      "test prompt",
      mockSessionManager as any,
      mockTokenCount$ as any,
      mockRuntimeEvents as any,
    );

    expect(mockRun).toHaveBeenCalledWith("test prompt", {
      prompter: expect.objectContaining({ prompt: expect.any(Function) }),
    });

    // Verify the headless prompter always returns empty string
    const runOpts = mockRun.mock.calls[0][1];
    const result = await runOpts.prompter.prompt({
      message: "msg",
      options: [{ label: "Yes", value: "yes" }],
    });
    expect(result).toBe("");
  });

  it("calls agent.run with initial prompt", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(
      mockAgent as any,
      "test prompt",
      mockSessionManager as any,
      mockTokenCount$ as any,
      mockRuntimeEvents as any,
    );
    expect(mockRun).toHaveBeenCalledWith("test prompt", expect.any(Object));
  });

  it("handles Aborted error", async () => {
    mockRun.mockRejectedValueOnce(new Error("Aborted"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runHeadless(
      mockAgent as any,
      "test prompt",
      mockSessionManager as any,
      mockTokenCount$ as any,
      mockRuntimeEvents as any,
    );
    expect(logSpy).toHaveBeenCalledWith("(Aborted)");
    logSpy.mockRestore();
  });

  it("handles generic error", async () => {
    mockRun.mockRejectedValueOnce(new Error("test error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runHeadless(
      mockAgent as any,
      "test prompt",
      mockSessionManager as any,
      mockTokenCount$ as any,
      mockRuntimeEvents as any,
    );
    expect(errSpy).toHaveBeenCalledWith("(Error: test error)");
    errSpy.mockRestore();
  });

  it("throws non-Error objects", async () => {
    mockRun.mockRejectedValueOnce("string error");
    await expect(
      runHeadless(
        mockAgent as any,
        "test prompt",
        mockSessionManager as any,
        mockTokenCount$ as any,
        mockRuntimeEvents as any,
      ),
    ).rejects.toBe("string error");
  });
});
