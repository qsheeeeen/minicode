import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
const { sessionPersistenceMock } = vi.hoisted(() => ({
  sessionPersistenceMock: {
    getProjectHash: vi.fn().mockReturnValue("testhash"),
    getMostRecent: vi.fn().mockResolvedValue(null),
    load: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent.js")>();
  return { ...actual, runAgent: mockRun };
});

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../services/session-persistence.js", () => ({
  SessionPersistence: sessionPersistenceMock,
}));

const mockOnChange = vi.fn().mockReturnValue(() => {});
const mockSubscribe = vi.fn().mockReturnValue(() => {});

const mockContext = {
  onChange: mockOnChange,
  getBlocks: vi.fn().mockReturnValue([]),
  getUserMessageCount: vi.fn().mockReturnValue(0),
  replaceBlocks: vi.fn(),
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

const mockShellService = { runSync: vi.fn().mockReturnValue("output") };

const mockRuntimeState = { setLogger: vi.fn() };

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
    await runHeadless(
      mockDeps,
      "test prompt",
      mockRuntimeEvents as any,
      mockShellService,
    );

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
    await runHeadless(
      mockDeps,
      "test prompt",
      mockRuntimeEvents as any,
      mockShellService,
    );
    expect(mockRun).toHaveBeenCalledWith(
      mockDeps,
      "test prompt",
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it("handles Aborted error", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockRun.mockRejectedValueOnce(abortErr);
    await runHeadless(
      mockDeps,
      "test prompt",
      mockRuntimeEvents as any,
      mockShellService,
    );
    expect(mockSessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "(Aborted)" }),
    );
  });

  it("handles generic error", async () => {
    mockRun.mockRejectedValueOnce(new Error("test error"));
    await runHeadless(
      mockDeps,
      "test prompt",
      mockRuntimeEvents as any,
      mockShellService,
    );
    expect(mockSessionManager.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "error",
        content: "(Error: test error)",
      }),
    );
  });

  it("throws non-Error objects", async () => {
    mockRun.mockRejectedValueOnce("string error");
    await expect(
      runHeadless(
        mockDeps,
        "test prompt",
        mockRuntimeEvents as any,
        mockShellService,
      ),
    ).rejects.toBe("string error");
  });
});
