import { describe, it, expect, vi } from "vitest";
import { switchSession } from "./session-lifecycle.js";

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn().mockResolvedValue({ info: vi.fn(), error: vi.fn() }),
}));

describe("switchSession", () => {
  it("wires session, logger, stats, and status message", async () => {
    const agent = {
      set logger(_val: any) {},
    };
    const reportStatus = vi.fn();
    const sessionManager = {
      setSession: vi.fn(),
      reportStatus,
    };
    const setCurrentSession = vi.fn();
    const sessionStats = { incrementSessionCount: vi.fn() };

    await switchSession({
      agent: agent as any,
      sessionManager: sessionManager as any,
      sessionName: "test-session",
      setCurrentSession,
      sessionStats: sessionStats as any,
      statusMessage: "Created session",
    });

    expect(sessionManager.setSession).toHaveBeenCalledWith("test-session");
    expect(setCurrentSession).toHaveBeenCalledWith("test-session");
    expect(sessionStats.incrementSessionCount).toHaveBeenCalledWith(
      "test-session",
    );
    expect(reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "Created session" }),
    );
  });

  it("skips status message when not provided", async () => {
    const reportStatus = vi.fn();
    const agent = {
      set logger(_val: any) {},
    };
    const sessionManager = {
      setSession: vi.fn(),
      reportStatus,
    };

    await switchSession({
      agent: agent as any,
      sessionManager: sessionManager as any,
      sessionName: "s2",
      setCurrentSession: vi.fn(),
      sessionStats: { incrementSessionCount: vi.fn() } as any,
    });

    expect(reportStatus).not.toHaveBeenCalled();
  });
});
