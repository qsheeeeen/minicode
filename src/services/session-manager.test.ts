import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "./session-manager.js";
import { SessionStats } from "./session-stats.js";
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

    it("accepts session stats", () => {
      const stats = new SessionStats();
      const sm = new SessionManager(undefined, stats);
      expect(sm.getSessionStats()).toBe(stats);
    });

    it("defaults session stats to undefined", () => {
      const sm = new SessionManager();
      expect(sm.getSessionStats()).toBeUndefined();
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
    it("emits session.changed on setSession", () => {
      const events = new RuntimeEvents();
      const seen: string[] = [];
      events.subscribe((event) => {
        if (event.type === "session.changed") seen.push(event.sessionName);
      });
      const sm = new SessionManager(undefined, undefined, events);
      const spy = vi
        .spyOn(SessionPersistence, "getSessionDir")
        .mockReturnValue("/tmp/minicode-session-manager-test");
      sm.setSession("next-session");
      spy.mockRestore();
      expect(seen).toEqual(["next-session"]);
    });
  });

  describe("user message ordinal", () => {
    it("starts at 0", () => {
      const sm = new SessionManager();
      expect(sm.getActiveUserMessageOrdinal()).toBe(0);
    });

    it("can be set and read back", () => {
      const sm = new SessionManager();
      sm.setActiveUserMessageOrdinal(5);
      expect(sm.getActiveUserMessageOrdinal()).toBe(5);
    });
  });

  describe("messages", () => {
    it("starts with empty messages", () => {
      const sm = new SessionManager();
      expect(sm.getMessages()).toEqual([]);
    });

    it("stores and retrieves messages", () => {
      const sm = new SessionManager();
      const msgs = [{ type: "user" as const, text: "hello" }];
      sm.setMessages(msgs);
      expect(sm.getMessages()).toEqual(msgs);
    });
  });

  describe("clearSession", () => {
    it("resets user message ordinal to 0", () => {
      const sm = new SessionManager();
      sm.setActiveUserMessageOrdinal(10);
      sm.clearSession();
      expect(sm.getActiveUserMessageOrdinal()).toBe(0);
    });

    it("clears messages", () => {
      const sm = new SessionManager();
      sm.setMessages([{ type: "user", text: "hello" }]);
      sm.clearSession();
      expect(sm.getMessages()).toEqual([]);
    });
  });
});
