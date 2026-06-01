import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRun = vi.fn();
const mockSetEvents = vi.fn();
const mockSetPrompter = vi.fn();
const mockOnChange = vi.fn().mockReturnValue(() => {});
const mockGetTurns = vi.fn().mockReturnValue([]);
const mockGetStatuses = vi.fn().mockReturnValue([]);

const mockAgent = {
  run: mockRun,
  setEvents: mockSetEvents,
  setPrompter: mockSetPrompter,
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

  it("sets headless events and prompter on agent", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(mockAgent as any, "test prompt");
    expect(mockSetEvents).toHaveBeenCalled();
    expect(mockSetPrompter).toHaveBeenCalled();
    const prompterArg = mockSetPrompter.mock.calls[0][0];
    expect(typeof prompterArg.prompt).toBe("function");
  });

  it("headless prompter always returns empty string", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    let capturedPrompt: Function = () => "yes";
    mockSetPrompter.mockImplementationOnce((p: any) => {
      capturedPrompt = p.prompt;
    });
    await runHeadless(mockAgent as any, "test prompt");
    const result = await capturedPrompt({
      message: "msg",
      options: [{ label: "Yes", value: "yes" }],
    });
    expect(result).toBe("");
  });

  it("calls agent.run with initial prompt", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(mockAgent as any, "test prompt");
    expect(mockRun).toHaveBeenCalledWith("test prompt");
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
