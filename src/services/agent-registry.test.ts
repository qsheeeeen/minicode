import { describe, it, expect, vi } from "vitest";
import {
  AgentRegistry,
  type AgentSession,
  type AgentStatus,
} from "./agent-registry.js";

const createMockSession = (
  id: string,
  type: "main" | "sub" = "sub",
  status: AgentStatus = "idle",
): AgentSession => ({
  id,
  type,
  agent: {} as any,
  status,
});

describe("AgentRegistry", () => {
  describe("register", () => {
    it("adds session to registry", () => {
      const registry = new AgentRegistry();
      const session = createMockSession("main");
      registry.register(session);
      expect(registry.get("main")).toBe(session);
    });
  });

  describe("get", () => {
    it("returns session by id", () => {
      const registry = new AgentRegistry();
      const session = createMockSession("2");
      registry.register(session);
      expect(registry.get("2")).toBe(session);
    });

    it("returns undefined for unknown id", () => {
      const registry = new AgentRegistry();
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("returns all sessions sorted by numeric id", () => {
      const registry = new AgentRegistry();
      registry.register(createMockSession("3"));
      registry.register(createMockSession("1"));
      registry.register(createMockSession("2"));
      const all = registry.getAll();
      expect(all.map((s) => s.id)).toEqual(["1", "2", "3"]);
    });
  });

  describe("updateStatus", () => {
    it("updates session status", () => {
      const registry = new AgentRegistry();
      const session = createMockSession("2", "sub", "idle");
      registry.register(session);
      registry.updateStatus("2", "running");
      expect(registry.get("2")?.status).toBe("running");
    });

    it("does nothing for unknown id", () => {
      const registry = new AgentRegistry();
      registry.updateStatus("unknown", "running");
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("updateSummary", () => {
    it("updates session summary", () => {
      const registry = new AgentRegistry();
      const session = createMockSession("2", "sub", "completed");
      registry.register(session);
      registry.updateSummary("2", "Fixed the bug");
      expect(registry.get("2")?.summary).toBe("Fixed the bug");
    });
  });

  describe("allocateSubId", () => {
    it("returns 2 when no sessions exist", () => {
      const registry = new AgentRegistry();
      expect(registry.allocateSubId()).toBe("2");
    });

    it("allocates sequentially when IDs are registered", () => {
      const registry = new AgentRegistry();
      // Allocate and register at 2
      expect(registry.allocateSubId()).toBe("2");
      registry.register(createMockSession("2", "sub", "running"));
      // Allocate and register at 3
      expect(registry.allocateSubId()).toBe("3");
      registry.register(createMockSession("3", "sub", "running"));
      // Allocate at 4 (not yet registered)
      expect(registry.allocateSubId()).toBe("4");
    });

    it("skips occupied running slots", () => {
      const registry = new AgentRegistry();
      registry.register(createMockSession("2", "sub", "running"));
      // Slot 2 occupied, so returns 3
      expect(registry.allocateSubId()).toBe("3");
    });

    it("does not reuse main session slot", () => {
      const registry = new AgentRegistry();
      registry.register(createMockSession("main", "main", "idle"));
      expect(registry.allocateSubId()).toBe("2");
    });

    it("wraps when all slots 2-9 are occupied by running agents", () => {
      const registry = new AgentRegistry();
      // Fill 2-9 all with running agents
      for (let i = 2; i <= 9; i++) {
        registry.register(createMockSession(String(i), "sub", "running"));
      }
      // All slots 2-9 are occupied (running), no completed/error to reuse
      // nextSubId is still 2 (never set since first loop never found free slot)
      // Falls through: returns nextSubId=2, then increments to 3
      expect(registry.allocateSubId()).toBe("2");
      // Next call: nextSubId=3, returns '3', increments to 4
      expect(registry.allocateSubId()).toBe("3");
    });
  });

  describe("remove", () => {
    it("removes session by id", () => {
      const registry = new AgentRegistry();
      registry.register(createMockSession("2"));
      registry.remove("2");
      expect(registry.get("2")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all sessions and resets nextSubId", () => {
      const registry = new AgentRegistry();
      registry.register(createMockSession("2"));
      registry.allocateSubId(); // should be 3
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
      expect(registry.allocateSubId()).toBe("2");
    });
  });

  describe("setUpdateCallback", () => {
    it("notifies callback on register", () => {
      const registry = new AgentRegistry();
      const cb = vi.fn();
      registry.setUpdateCallback(cb);
      registry.register(createMockSession("2"));
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "2" })]),
      );
    });

    it("notifies callback on remove", () => {
      const registry = new AgentRegistry();
      const cb = vi.fn();
      registry.setUpdateCallback(cb);
      registry.register(createMockSession("2"));
      cb.mockClear();
      registry.remove("2");
      expect(cb).toHaveBeenCalledWith([]);
    });

    it("calls updateCallback on updateStatus", () => {
      const registry = new AgentRegistry();
      const callback = vi.fn();
      registry.setUpdateCallback(callback);
      registry.register(createMockSession("1", "main"));
      callback.mockClear();
      
      registry.updateStatus("1", "completed");
      
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0][0].status).toBe("completed");
    });

    it("calls updateCallback on updateSummary", () => {
      const registry = new AgentRegistry();
      const callback = vi.fn();
      registry.setUpdateCallback(callback);
      registry.register(createMockSession("1", "main"));
      callback.mockClear();
      
      registry.updateSummary("1", "done");
      
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0][0].summary).toBe("done");
    });
  });
});
