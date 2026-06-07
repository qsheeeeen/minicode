import { describe, it, expect, vi } from "vitest";
import { switchSession } from "./session-lifecycle.js";

describe("switchSession", () => {
  it("wires session, logger, stats, and status message", async () => {
    const agent = {
      setSession: vi.fn(),
      setLogger: vi.fn(),
      getStore: vi.fn().mockReturnValue({ addStatus: vi.fn() }),
    };
    const setCurrentSession = vi.fn();
    const sessionStats = { incrementSessionCount: vi.fn() };

    await switchSession({
      agent: agent as any,
      sessionName: "test-session",
      setCurrentSession,
      sessionStats: sessionStats as any,
      statusMessage: "Created session",
    });

    expect(agent.setSession).toHaveBeenCalledWith("test-session");
    expect(agent.setLogger).toHaveBeenCalled();
    expect(setCurrentSession).toHaveBeenCalledWith("test-session");
    expect(sessionStats.incrementSessionCount).toHaveBeenCalledWith(
      "test-session",
    );
    expect(agent.getStore().addStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "Created session" }),
    );
  });

  it("skips status message when not provided", async () => {
    const addStatus = vi.fn();
    const agent = {
      setSession: vi.fn(),
      setLogger: vi.fn(),
      getStore: vi.fn().mockReturnValue({ addStatus }),
    };

    await switchSession({
      agent: agent as any,
      sessionName: "s2",
      setCurrentSession: vi.fn(),
      sessionStats: { incrementSessionCount: vi.fn() } as any,
    });

    expect(addStatus).not.toHaveBeenCalled();
  });
});
