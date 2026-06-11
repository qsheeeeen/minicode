import { describe, it, expect } from "vitest";
import { SessionManager } from "./session-manager.js";
import { SessionStats } from "./session-stats.js";

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

  describe("store and journal accessors", () => {
    it("provides a MessageStore", () => {
      const sm = new SessionManager();
      expect(sm.getStore()).toBeDefined();
    });

    it("provides a ChangeJournal", () => {
      const sm = new SessionManager();
      expect(sm.getChangeJournal()).toBeDefined();
    });
  });

  describe("turn index", () => {
    it("starts at 0", () => {
      const sm = new SessionManager();
      expect(sm.getActiveTurnIdx()).toBe(0);
    });

    it("can be set and read back", () => {
      const sm = new SessionManager();
      sm.setActiveTurnIdx(5);
      expect(sm.getActiveTurnIdx()).toBe(5);
    });
  });

  describe("messages", () => {
    it("starts with empty messages", () => {
      const sm = new SessionManager();
      expect(sm.getMessages()).toEqual([]);
    });

    it("stores and retrieves messages", () => {
      const sm = new SessionManager();
      const msgs = [{ role: "user" as const, content: "hello" }];
      sm.setMessages(msgs);
      expect(sm.getMessages()).toEqual(msgs);
    });
  });

  describe("clearSession", () => {
    it("resets turn index to 0", () => {
      const sm = new SessionManager();
      sm.setActiveTurnIdx(10);
      sm.clearSession();
      expect(sm.getActiveTurnIdx()).toBe(0);
    });

    it("clears messages", () => {
      const sm = new SessionManager();
      sm.setMessages([{ role: "user", content: "hello" }]);
      sm.clearSession();
      expect(sm.getMessages()).toEqual([]);
    });
  });
});
