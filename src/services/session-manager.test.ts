import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./session-manager.js";
import { RuntimeEvents } from "./runtime-events.js";
import { SessionPersistence } from "./session-persistence.js";

describe("SessionManager", () => {
  describe("constructor", () => {
    it("generates a default session name", () => {
      const sm = new SessionManager();
      expect(sm.getSessionName()).toMatch(/^session-\d+$/);
    });

    it("accepts a custom session name", () => {
      const sm = new SessionManager("my-session");
      expect(sm.getSessionName()).toBe("my-session");
    });
  });

  describe("context and journal accessors", () => {
    it("provides a MessageStore", () => {
      const sm = new SessionManager();
      expect(sm.getContext()).toBeDefined();
    });

    it("provides a ChangeJournal", () => {
      const sm = new SessionManager();
      expect(sm.getChangeJournal()).toBeDefined();
    });
  });

  describe("events", () => {
    it("emits session.changed on setSession", async () => {
      const events = new RuntimeEvents();
      const seen: string[] = [];
      events.subscribe((event) => {
        if (event.type === "session.changed") seen.push(event.sessionName);
      });
      const sm = new SessionManager(undefined, events);
      const spy = vi
        .spyOn(SessionPersistence, "getSessionDir")
        .mockReturnValue("/tmp/minicode-session-manager-test");
      await sm.setSession("next-session");
      spy.mockRestore();
      expect(seen).toEqual(["next-session"]);
    });
  });

  describe("active message id", () => {
    it("starts undefined", () => {
      const sm = new SessionManager();
      expect(sm.getActiveMessageId()).toBeUndefined();
    });

    it("can be set and read back", () => {
      const sm = new SessionManager();
      sm.setActiveMessageId("m5");
      expect(sm.getActiveMessageId()).toBe("m5");
    });
  });

  describe("messages", () => {
    it("starts with empty messages", () => {
      const sm = new SessionManager();
      expect(sm.getContext().getBlocks()).toEqual([]);
    });

    it("stores and retrieves messages", () => {
      const sm = new SessionManager();
      const msgs = [{ type: "user" as const, text: "hello", id: "u1" }];
      sm.getContext().replaceBlocks(msgs);
      expect(sm.getContext().getBlocks()).toEqual(msgs);
    });
  });

  describe("clearSession", () => {
    it("clears the active message id", () => {
      const sm = new SessionManager();
      sm.setActiveMessageId("m10");
      sm.clearSession();
      expect(sm.getActiveMessageId()).toBeUndefined();
    });

    it("clears messages", () => {
      const sm = new SessionManager();
      sm.getContext().replaceBlocks([{ type: "user", text: "hello" }]);
      sm.clearSession();
      expect(sm.getContext().getBlocks()).toEqual([]);
    });
  });

  describe("saveStore tree sync", () => {
    let appendSpy: ReturnType<typeof vi.spyOn>;
    let rewriteSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      appendSpy = vi
        .spyOn(SessionPersistence, "appendEntries")
        .mockResolvedValue(undefined);
      rewriteSpy = vi
        .spyOn(SessionPersistence, "rewriteTree")
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      appendSpy.mockRestore();
      rewriteSpy.mockRestore();
    });

    function turnIds(entries: readonly { type: string; id?: string }[]) {
      return entries
        .filter((e) => e.type === "turn")
        .map((e) => (e as { id: string }).id);
    }

    it("final save appends the tail turn; mid-run saves skip it", async () => {
      const sm = new SessionManager("s");
      const context = sm.getContext();
      context.replaceBlocks([
        { type: "user", text: "one", id: "u1" },
        { type: "text", text: "r1" },
        { type: "user", text: "two", id: "u2" },
        { type: "text", text: "r2" },
      ]);

      await sm.saveStore({ model: "m", totalTokens: 1 }); // mid-run
      expect(appendSpy).toHaveBeenCalledTimes(1);
      let entries = appendSpy.mock.calls[0][1];
      expect(turnIds(entries)).toEqual(["u1"]); // u2 is still in flight
      expect(entries[entries.length - 1]).toMatchObject({
        type: "leaf",
        activeTurnId: "u1",
        model: "m",
        totalTokens: 1,
      });

      await sm.saveStore({ model: "m", totalTokens: 2 }, { final: true });
      entries = appendSpy.mock.calls[1][1];
      expect(turnIds(entries)).toEqual(["u2"]);
      const leaf = entries[entries.length - 1] as { activeTurnId: string };
      expect(leaf.activeTurnId).toBe("u2");
    });

    it("context prefix (abort/undo) truncates the tree and rewrites", async () => {
      const sm = new SessionManager("s");
      const context = sm.getContext();
      context.replaceBlocks([
        { type: "user", text: "one", id: "u1" },
        { type: "text", text: "r1" },
        { type: "user", text: "two", id: "u2" },
      ]);
      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });
      expect(rewriteSpy).not.toHaveBeenCalled();

      // Abort rolled the context back to before u2.
      context.truncateBeforeUserMessageId("u2");
      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });

      expect(rewriteSpy).toHaveBeenCalledTimes(1);
      const entries = rewriteSpy.mock.calls[0][1];
      expect(turnIds(entries)).toEqual(["u1"]);
      const leaf = entries[entries.length - 1] as { activeTurnId: string };
      expect(leaf.activeTurnId).toBe("u1");
    });

    it("divergence (compression) rebuilds the tree from context", async () => {
      const sm = new SessionManager("s");
      sm.getContext().replaceBlocks([
        { type: "user", text: "one", id: "u1" },
        { type: "user", text: "two", id: "u2" },
      ]);
      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });

      // Compression replaced the history with a summary block (fresh id).
      sm.getContext().replaceBlocks([
        { type: "user", text: "summary", id: "s1" },
        { type: "text", text: "kept" },
      ]);
      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });

      expect(rewriteSpy).toHaveBeenCalledTimes(1);
      const entries = rewriteSpy.mock.calls[0][1];
      expect(turnIds(entries)).toEqual(["s1"]);
    });

    it("restoreFrom(v1) migrates: first save rewrites whole file as v2", async () => {
      const sm = new SessionManager("s");
      sm.restoreFrom({
        version: 1,
        blocks: [
          { type: "user", text: "old" }, // no id yet — replaceBlocks assigns
          { type: "text", text: "r" },
        ],
        model: "v1-model",
        totalTokens: 5,
      });

      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });

      expect(rewriteSpy).toHaveBeenCalledTimes(1);
      const entries = rewriteSpy.mock.calls[0][1];
      const turns = entries.filter((e) => e.type === "turn");
      expect(turns).toHaveLength(1);
      const summary = sm.getContext().getBlocks()[0] as { id?: string };
      expect((turns[0] as { id: string }).id).toBe(summary.id);

      // Second save is a normal append — migration is done.
      sm.getContext().replaceBlocks([
        ...sm.getContext().getBlocks(),
        { type: "user", text: "new", id: "n1" },
      ]);
      await sm.saveStore({ model: "m", totalTokens: 1 }, { final: true });
      expect(rewriteSpy).toHaveBeenCalledTimes(1);
      expect(turnIds(appendSpy.mock.calls[0][1])).toEqual(["n1"]);
    });

    it("restoreFrom(v2) rebuilds context from the active path", () => {
      const sm = new SessionManager("s");
      const u1Blocks = [{ type: "user" as const, text: "one", id: "u1" }];
      const u2Blocks = [{ type: "user" as const, text: "two", id: "u2" }];
      sm.restoreFrom({
        version: 2,
        turns: [
          { type: "turn", id: "u1", parentId: null, ts: 1, blocks: u1Blocks },
          { type: "turn", id: "u2", parentId: "u1", ts: 2, blocks: u2Blocks },
        ],
        activeTurnId: "u2",
        model: "m",
        totalTokens: 3,
      });

      expect(sm.getContext().getBlocks()).toEqual([...u1Blocks, ...u2Blocks]);
      expect(sm.getTree().activeTurnId).toBe("u2");
    });

    it("skips disk for non-persistent sessions", async () => {
      const sm = new SessionManager(undefined, undefined, false);
      sm.getContext().replaceBlocks([{ type: "user", text: "hi", id: "u1" }]);
      await sm.saveStore({ model: "m", totalTokens: 10 });
      expect(appendSpy).not.toHaveBeenCalled();
      expect(rewriteSpy).not.toHaveBeenCalled();
    });
  });
});

describe("saveStore serialization", () => {
  it("runs concurrent saves sequentially (no interleaved writes)", async () => {
    const order: string[] = [];
    let inFlight = false;
    const save = vi.fn(async () => {
      if (inFlight) throw new Error("overlapping save");
      inFlight = true;
      order.push("start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("end");
      inFlight = false;
    });
    vi.spyOn(SessionPersistence, "appendEntries").mockImplementation(save);

    const sm = new SessionManager("s", undefined, new RuntimeEvents());
    await Promise.all([
      sm.saveStore({ model: "m", totalTokens: 1 }),
      sm.saveStore({ model: "m", totalTokens: 2 }),
    ]);

    expect(order).toEqual(["start", "end", "start", "end"]);
  });
});
