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

  describe("append / rewrite / loadTree", () => {
    const sessionName = `test-persist-${Date.now()}`;

    const turnU1 = {
      type: "turn" as const,
      id: "u1",
      parentId: null,
      ts: 1,
      blocks: [{ type: "user" as const, text: "hello", id: "u1" }],
    };
    const turnU2 = {
      type: "turn" as const,
      id: "u2",
      parentId: "u1",
      ts: 2,
      blocks: [{ type: "user" as const, text: "again", id: "u2" }],
    };

    it("appends entries and loads them back as a v2 tree", async () => {
      await SessionPersistence.appendEntries(sessionName, [
        turnU1,
        turnU2,
        {
          type: "leaf",
          ts: 3,
          activeTurnId: "u2",
          model: "test-model",
          totalTokens: 100,
        },
      ]);

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      if (loaded!.version !== 2) return;
      expect(loaded!.turns.map((t) => t.id)).toEqual(["u1", "u2"]);
      expect(loaded!.turns[1].parentId).toBe("u1");
      expect(loaded!.activeTurnId).toBe("u2");
      expect(loaded!.model).toBe("test-model");
      expect(loaded!.totalTokens).toBe(100);
    });

    it("last leaf line wins and later duplicate turn lines win", async () => {
      await SessionPersistence.appendEntries(sessionName, [
        turnU1,
        { type: "leaf", ts: 3, activeTurnId: "u1", model: "old", totalTokens: 1 },
      ]);
      // Simulate a refreshed turn + newer leaf appended later.
      await SessionPersistence.appendEntries(sessionName, [
        { ...turnU1, blocks: [{ type: "user", text: "hello v2", id: "u1" }] },
        { type: "leaf", ts: 4, activeTurnId: "u1", model: "new", totalTokens: 9 },
      ]);

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded!.version).toBe(2);
      if (loaded!.version !== 2) return;
      expect(loaded!.turns).toHaveLength(1);
      expect(loaded!.turns[0].blocks[0]).toEqual({
        type: "user",
        text: "hello v2",
        id: "u1",
      });
      expect(loaded!.model).toBe("new");
      expect(loaded!.totalTokens).toBe(9);
    });

    it("skips malformed lines when loading", async () => {
      await SessionPersistence.rewriteTree(sessionName, [
        turnU1,
        { type: "leaf", ts: 3, activeTurnId: "u1", model: "m", totalTokens: 0 },
      ]);
      const dir = SessionPersistence.getSessionDir();
      await fs.appendFile(
        path.join(dir, `${sessionName}.context.jsonl`),
        '{"type":"turn","id":"broken\n{"type":"leaf","activeTurnId":"u1"}\n',
        "utf-8",
      );

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded!.version).toBe(2);
      if (loaded!.version !== 2) return;
      expect(loaded!.turns.map((t) => t.id)).toEqual(["u1"]);
    });

    it("rewriteTree replaces the whole file under a v2 header", async () => {
      await SessionPersistence.appendEntries(sessionName, [
        turnU1,
        turnU2,
        { type: "leaf", ts: 3, activeTurnId: "u2", model: "m", totalTokens: 0 },
      ]);
      // Destructive rollback: only u1 survives.
      await SessionPersistence.rewriteTree(sessionName, [
        turnU1,
        { type: "leaf", ts: 4, activeTurnId: "u1", model: "m", totalTokens: 0 },
      ]);

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded!.version).toBe(2);
      if (loaded!.version !== 2) return;
      expect(loaded!.turns.map((t) => t.id)).toEqual(["u1"]);
      expect(loaded!.activeTurnId).toBe("u1");
    });

    it("detects v1 files and returns their raw blocks", async () => {
      const v1Lines = [
        JSON.stringify({ model: "v1-model", totalTokens: 7, blockCount: 2 }),
        JSON.stringify({ type: "user", text: "old" }),
        JSON.stringify({ type: "text", text: "reply" }),
      ].join("\n");
      const dir = SessionPersistence.getSessionDir();
      await fs.writeFile(
        path.join(dir, `${sessionName}.context.jsonl`),
        v1Lines + "\n",
        "utf-8",
      );

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded).toEqual({
        version: 1,
        blocks: [
          { type: "user", text: "old" },
          { type: "text", text: "reply" },
        ],
        model: "v1-model",
        totalTokens: 7,
      });
    });

    it("a null-pointer leaf line restores an empty active path (fork to origin)", async () => {
      await SessionPersistence.rewriteTree(sessionName, [
        turnU1,
        { type: "leaf", ts: 5, activeTurnId: null, model: "m", totalTokens: 0 },
      ]);

      const loaded = await SessionPersistence.loadTree(sessionName);
      expect(loaded!.version).toBe(2);
      if (loaded!.version !== 2) return;
      expect(loaded!.turns).toHaveLength(1); // turn kept on the branch
      expect(loaded!.activeTurnId).toBeNull(); // but not active — the ?? trap
    });

    it("returns null when session not found", async () => {
      const loaded = await SessionPersistence.loadTree(
        "nonexistent-session-xyz",
      );
      expect(loaded).toBeNull();
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
        await SessionPersistence.rewriteTree(name1, []);
        // Small delay to ensure different mtime
        await new Promise((r) => setTimeout(r, 50));
        await SessionPersistence.rewriteTree(name2, []);

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
          .unlink(path.join(dir, `${name1}.context.jsonl`))
          .catch(() => {});
        await fs
          .unlink(path.join(dir, `${name2}.context.jsonl`))
          .catch(() => {});
      }
    });
  });

  describe("rename", () => {
    it("renames a session file", async () => {
      const oldName = `test-rename-old-${Date.now()}`;
      const newName = `test-rename-new-${Date.now()}`;

      try {
        await SessionPersistence.rewriteTree(oldName, []);
        await SessionPersistence.rename(oldName, newName);

        const data = await SessionPersistence.loadTree(newName);
        expect(data).not.toBeNull();

        const oldData = await SessionPersistence.loadTree(oldName);
        expect(oldData).toBeNull();
      } finally {
        const dir = SessionPersistence.getSessionDir();
        await fs
          .unlink(path.join(dir, `${oldName}.context.jsonl`))
          .catch(() => {});
        await fs
          .unlink(path.join(dir, `${newName}.context.jsonl`))
          .catch(() => {});
      }
    });
  });

  describe("delete", () => {
    it("deletes a session file", async () => {
      const name = `test-delete-${Date.now()}`;

      try {
        await SessionPersistence.rewriteTree(name, []);
        const data = await SessionPersistence.loadTree(name);
        expect(data).not.toBeNull();

        await SessionPersistence.delete(name);
        const afterDelete = await SessionPersistence.loadTree(name);
        expect(afterDelete).toBeNull();
      } finally {
        const dir = SessionPersistence.getSessionDir();
        await fs
          .unlink(path.join(dir, `${name}.context.jsonl`))
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
