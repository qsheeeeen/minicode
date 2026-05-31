import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager, type SessionData } from "./session.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtime: new Date("2024-01-01T10:00:00Z") }),
  },
}));

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computeProjectHash", () => {
    it("computes consistent hash for same cwd", () => {
      const manager1 = new SessionManager();
      const manager2 = new SessionManager();
      expect(manager1.getProjectHash()).toBe(manager2.getProjectHash());
    });

    it("returns 12 character hex string", () => {
      const manager = new SessionManager();
      const hash = manager.getProjectHash();
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });
  });

  describe("getSessionDir", () => {
    it("returns path in sessions directory", () => {
      const manager = new SessionManager();
      const dir = manager.getSessionDir();
      expect(dir).toContain(".minicode/sessions/");
    });
  });

  describe("list", () => {
    it("returns empty array when no sessions", async () => {
      const fs = await import("fs/promises");
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const manager = new SessionManager();
      const sessions = await manager.list();
      expect(sessions).toEqual([]);
    });

    it("lists JSONL sessions sorted by mtime descending", async () => {
      const fs = await import("fs/promises");
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        "old.context.jsonl",
        "new.context.jsonl",
      ]);
      (fs.default.stat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ mtime: new Date("2024-01-02T10:00:00Z") })
        .mockResolvedValueOnce({ mtime: new Date("2024-01-01T10:00:00Z") });
      const manager = new SessionManager();
      const sessions = await manager.list();
      expect(sessions[0].name).toBe("old");
      expect(sessions[1].name).toBe("new");
    });
  });

  describe("listNames", () => {
    it("returns session names without extension", async () => {
      const fs = await import("fs/promises");
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        "a.context.jsonl",
        "b.context.jsonl",
        "c.txt",
      ]);
      const manager = new SessionManager();
      const names = await manager.listNames();
      expect(names).toEqual(["a", "b"]);
    });
  });

  describe("getMostRecent", () => {
    it("returns null when no sessions", async () => {
      const fs = await import("fs/promises");
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const manager = new SessionManager();
      const recent = await manager.getMostRecent();
      expect(recent).toBeNull();
    });
  });

  describe("get", () => {
    it("returns parsed JSONL session data", async () => {
      const fs = await import("fs/promises");
      const header = JSON.stringify({
        model: "claude-3",
        totalTokens: 1000,
        msgCount: 1,
      });
      const msg = JSON.stringify({ role: "user", content: "hello" });
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        `${header}\n${msg}\n`,
      );
      const manager = new SessionManager();
      const data = await manager.get("test-session");
      expect(data?.model).toBe("claude-3");
      expect(data?.messages).toHaveLength(1);
      expect(data?.totalTokens).toBe(1000);
    });

    it("skips malformed lines", async () => {
      const fs = await import("fs/promises");
      const header = JSON.stringify({ model: "test", totalTokens: 0, msgCount: 2 });
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        `${header}\n{bad json}\n{"role":"user","content":"ok"}\n`,
      );
      const manager = new SessionManager();
      const data = await manager.get("test");
      expect(data?.messages).toHaveLength(1);
    });

    it("falls back to legacy .json format", async () => {
      const fs = await import("fs/promises");
      // First call (JSONL) fails, second call (legacy .json) succeeds
      (fs.default.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockResolvedValueOnce(
          JSON.stringify({
            model: "legacy",
            messages: [],
            totalTokens: 0,
          }),
        );
      const manager = new SessionManager();
      const data = await manager.get("old-session");
      expect(data?.model).toBe("legacy");
    });

    it("returns null when not found in either format", async () => {
      const fs = await import("fs/promises");
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT"),
      );
      const manager = new SessionManager();
      const data = await manager.get("nonexistent");
      expect(data).toBeNull();
    });
  });

  describe("save", () => {
    it("writes JSONL with header and messages", async () => {
      const fs = await import("fs/promises");
      const data: SessionData = {
        model: "claude-3",
        messages: [{ role: "user", content: "hello" }],
        totalTokens: 100,
      };
      const manager = new SessionManager();
      await manager.save("test", data);
      // Should write to .tmp path first
      expect(fs.default.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.any(String),
      );
      // Should rename .tmp to final path
      expect(fs.default.rename).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.stringContaining("test.context.jsonl"),
      );
      // Verify JSONL content
      const content = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      const lines = content.split("\n").filter((l: string) => l.trim());
      const header = JSON.parse(lines[0]);
      expect(header.model).toBe("claude-3");
      expect(header.msgCount).toBe(1);
      expect(JSON.parse(lines[1])).toEqual({ role: "user", content: "hello" });
    });
  });

  describe("delete", () => {
    it("attempts to delete both JSONL and legacy .json", async () => {
      const fs = await import("fs/promises");
      const manager = new SessionManager();
      await manager.delete("test-session");
      expect(fs.default.unlink).toHaveBeenCalledTimes(2);
      expect(fs.default.unlink).toHaveBeenCalledWith(
        expect.stringContaining("test-session.context.jsonl"),
      );
      expect(fs.default.unlink).toHaveBeenCalledWith(
        expect.stringContaining("test-session.json"),
      );
    });
  });

  describe("rename", () => {
    it("renames JSONL session files", async () => {
      const fs = await import("fs/promises");
      const manager = new SessionManager();
      await manager.rename("old-name", "new-name");
      expect(fs.default.rename).toHaveBeenCalledWith(
        expect.stringContaining("old-name.context.jsonl"),
        expect.stringContaining("new-name.context.jsonl"),
      );
    });
  });
});
