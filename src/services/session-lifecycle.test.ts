import { describe, it, expect, vi } from "vitest";
import { switchSession } from "./session-lifecycle.js";

describe("switchSession", () => {
  it("wires session, logger, stats, and status message", async () => {
    const agent = {
      set logger(_val: any) {},
    };
    const addStatus = vi.fn();
    const sessionManager = {
      setSession: vi.fn(),
      getStore: vi.fn().mockReturnValue({ addStatus }),
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
    expect(addStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "Created session" }),
    );
  });

  it("skips status message when not provided", async () => {
    const addStatus = vi.fn();
    const agent = {
      set logger(_val: any) {},
    };
    const sessionManager = {
      setSession: vi.fn(),
      getStore: vi.fn().mockReturnValue({ addStatus }),
    };

    await switchSession({
      agent: agent as any,
      sessionManager: sessionManager as any,
      sessionName: "s2",
      setCurrentSession: vi.fn(),
      sessionStats: { incrementSessionCount: vi.fn() } as any,
    });

    expect(addStatus).not.toHaveBeenCalled();
  });
});
