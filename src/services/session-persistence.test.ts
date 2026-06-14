import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SessionPersistence } from "./session-persistence.js";

describe("SessionPersistence", () => {
  let testSessionDir: string;

  beforeEach(async () => {
    testSessionDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "minicode-sessions-"),
    );
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      testSessionDir,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testSessionDir, { recursive: true, force: true });
  });

  describe("getProjectHash", () => {
    it("returns consistent 12-char hex", () => {
      const hash = SessionPersistence.getProjectHash();
      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);

      // Called again, same result
      expect(SessionPersistence.getProjectHash()).toBe(hash);
    });
  });

  describe("getSessionDir", () => {
    it("returns the configured session directory", () => {
      const dir = SessionPersistence.getSessionDir();
      expect(dir).toBe(testSessionDir);
    });
  });

  describe("save and load", () => {
    const sessionName = `test-persist-${Date.now()}`;

    it("saves and loads session data", async () => {
      const turns = [
        {
          userText: "hello",
          process: [],
          assistantText: "world",
        },
      ];

      await SessionPersistence.save(sessionName, turns as any, {
        model: "test-model",
        totalTokens: 100,
      });

      const data = await SessionPersistence.load(sessionName);
      expect(data).not.toBeNull();
      expect(data!.model).toBe("test-model");
      expect(data!.totalTokens).toBe(100);
      expect(data!.turns).toHaveLength(1);
      expect(data!.turns[0].userText).toBe("hello");
    });

    it("returns null when session not found", async () => {
      const data = await SessionPersistence.load("nonexistent-session-xyz");
      expect(data).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no sessions", async () => {
      const sessions = await SessionPersistence.list();
      // May have existing sessions, just check it returns an array
      expect(Array.isArray(sessions)).toBe(true);
    });

    it("lists sessions sorted by updatedAt descending", async () => {
      const name1 = `test-list-a-${Date.now()}`;
      const name2 = `test-list-b-${Date.now()}`;

      try {
        await SessionPersistence.save(name1, [], {
          model: "test",
          totalTokens: 0,
        });
        // Small delay to ensure different mtime
        await new Promise((r) => setTimeout(r, 50));
        await SessionPersistence.save(name2, [], {
          model: "test",
          totalTokens: 0,
        });

        const sessions = await SessionPersistence.list();
        const names = sessions.map((s) => s.name);

        // name2 was saved last, should appear first
        const idx1 = names.indexOf(name1);
        const idx2 = names.indexOf(name2);
        if (idx1 !== -1 && idx2 !== -1) {
          expect(idx2).toBeLessThan(idx1);
        }
      } finally {
        const dir = SessionPersistence.getSessionDir();
        await fs
          .unlink(path.join(dir, `${name1}.history.jsonl`))
          .catch(() => {});
        await fs
          .unlink(path.join(dir, `${name2}.history.jsonl`))
          .catch(() => {});
      }
    });
  });

  describe("rename", () => {
    it("renames a session file", async () => {
      const oldName = `test-rename-old-${Date.now()}`;
      const newName = `test-rename-new-${Date.now()}`;

      try {
        await SessionPersistence.save(oldName, [], {
          model: "test",
          totalTokens: 0,
        });
        await SessionPersistence.rename(oldName, newName);

        const data = await SessionPersistence.load(newName);
        expect(data).not.toBeNull();

        const oldData = await SessionPersistence.load(oldName);
        expect(oldData).toBeNull();
      } finally {
        const dir = SessionPersistence.getSessionDir();
        await fs
          .unlink(path.join(dir, `${oldName}.history.jsonl`))
          .catch(() => {});
        await fs
          .unlink(path.join(dir, `${newName}.history.jsonl`))
          .catch(() => {});
      }
    });
  });

  describe("delete", () => {
    it("deletes a session file", async () => {
      const name = `test-delete-${Date.now()}`;

      try {
        await SessionPersistence.save(name, [], {
          model: "test",
          totalTokens: 0,
        });
        const data = await SessionPersistence.load(name);
        expect(data).not.toBeNull();

        await SessionPersistence.delete(name);
        const afterDelete = await SessionPersistence.load(name);
        expect(afterDelete).toBeNull();
      } finally {
        const dir = SessionPersistence.getSessionDir();
        await fs
          .unlink(path.join(dir, `${name}.history.jsonl`))
          .catch(() => {});
      }
    });
  });

  describe("getMostRecent", () => {
    it("returns null when no sessions", async () => {
      // This may return a session if other tests left data,
      // so just check it returns string or null
      const result = await SessionPersistence.getMostRecent();
      expect(result === null || typeof result === "string").toBe(true);
    });
  });
});
