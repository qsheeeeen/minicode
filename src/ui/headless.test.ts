import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRun = vi.fn();
const mockOnChange = vi.fn().mockReturnValue(() => {});
const mockGetTurns = vi.fn().mockReturnValue([]);
const mockGetStatuses = vi.fn().mockReturnValue([]);

const mockAgent = {
  run: mockRun,
  getStore: vi.fn().mockReturnValue({
    onChange: mockOnChange,
    getTurns: mockGetTurns,
    getStatuses: mockGetStatuses,
    toLLMMessages: vi.fn().mockReturnValue([]),
  }),
  getTools: vi.fn().mockReturnValue(new Map()),
  setTokenCount: vi.fn(),
  setSession: vi.fn(),
  setMessages: vi.fn(),
};

import { runHeadless } from "./headless.js";

describe("runHeadless", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls agent.run with prompter that returns empty string", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(mockAgent as any, "test prompt");

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
    await runHeadless(mockAgent as any, "test prompt");
    expect(mockRun).toHaveBeenCalledWith("test prompt", expect.any(Object));
  });

  it("handles Aborted error", async () => {
    mockRun.mockRejectedValueOnce(new Error("Aborted"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runHeadless(mockAgent as any, "test prompt");
    expect(logSpy).toHaveBeenCalledWith("(Aborted)");
    logSpy.mockRestore();
  });

  it("handles generic error", async () => {
    mockRun.mockRejectedValueOnce(new Error("test error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runHeadless(mockAgent as any, "test prompt");
    expect(errSpy).toHaveBeenCalledWith("(Error: test error)");
    errSpy.mockRestore();
  });

  it("throws non-Error objects", async () => {
    mockRun.mockRejectedValueOnce("string error");
    await expect(runHeadless(mockAgent as any, "test prompt")).rejects.toBe(
      "string error",
    );
  });
});
