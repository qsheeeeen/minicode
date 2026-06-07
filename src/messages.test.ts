import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MessageStore,
  toDisplayMessages,
  type StatusMessage,
} from "./messages.js";
import type { MessageParam } from "./llm/types.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi
      .fn()
      .mockResolvedValue({ mtime: new Date("2024-01-01T10:00:00Z") }),
  },
}));

describe("toDisplayMessages", () => {
  it("renders user string turns", () => {
    const turns: MessageParam[] = [{ role: "user", content: "hello" }];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hello");
  });

  it("renders text blocks", () => {
    const turns: MessageParam[] = [
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("text");
    expect(result[0].content).toBe("hi there");
  });

  it("attaches tool_result content to matching tool_use", () => {
    const turns: MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Read",
            input: { path: "/a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "file contents" },
        ],
      },
    ];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    if (result[0].role === "tool") {
      expect(result[0].output).toBe("file contents");
      expect(result[0].name).toBe("Read");
    }
  });

  it("interleaves statuses with turns based on turnIndex", () => {
    const turns: MessageParam[] = [{ role: "user", content: "hello" }];
    const statuses: StatusMessage[] = [
      { role: "status", content: "done", timestamp: new Date(), turnIndex: 1 },
    ];
    const result = toDisplayMessages(turns, statuses);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("status");
  });

  it("places turnIndex 0 statuses before all turns", () => {
    const turns: MessageParam[] = [{ role: "user", content: "hello" }];
    const statuses: StatusMessage[] = [
      {
        role: "status",
        content: "cleared",
        timestamp: new Date(),
        turnIndex: 0,
      },
    ];
    const result = toDisplayMessages(turns, statuses);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("status");
    expect(result[1].role).toBe("user");
  });
});

describe("MessageStore", () => {
  it("setTurns replaces turns", () => {
    const store = new MessageStore();
    store.setTurns([{ role: "user", content: "hello" }]);
    expect(store.getTurns()).toHaveLength(1);
  });

  it("addUserMessage appends user turn", () => {
    const store = new MessageStore();
    store.addUserMessage("hello");
    expect(store.getTurns()[0]).toEqual({ role: "user", content: "hello" });
  });

  it("toLLMMessages returns turns directly", () => {
    const store = new MessageStore();
    store.addUserMessage("hello");
    expect(store.toLLMMessages()).toEqual([{ role: "user", content: "hello" }]);
  });

  it("notifies onChange on setTurns", () => {
    const store = new MessageStore();
    const cb = vi.fn();
    store.onChange(cb);
    store.setTurns([{ role: "user", content: "hello" }]);
    expect(cb).toHaveBeenCalled();
  });

  it("clear removes all turns and statuses", () => {
    const store = new MessageStore();
    store.addUserMessage("hello");
    store.addStatus({ role: "status", content: "done", timestamp: new Date() });
    store.clear();
    expect(store.getTurns()).toEqual([]);
    expect(store.getStatuses()).toEqual([]);
  });

  it("streaming state toggles and notifies", () => {
    const store = new MessageStore();
    const cb = vi.fn();
    store.onChange(cb);
    store.setStreaming(true);
    expect(store.isStreaming()).toBe(true);
    expect(cb).toHaveBeenCalled();
  });
});

describe("MessageStore session persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getProjectHash", () => {
    it("returns consistent 12-char hex", () => {
      const h1 = MessageStore.getProjectHash();
      const h2 = MessageStore.getProjectHash();
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{12}$/);
    });
  });

  describe("getSessionDir", () => {
    it("returns path under .minicode/sessions", () => {
      expect(MessageStore.getSessionDir()).toContain(".minicode/sessions/");
    });
  });

  describe("list", () => {
    it("returns empty array when no sessions", async () => {
      const fsMod = await import("fs/promises");
      (fsMod.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const sessions = await MessageStore.list();
      expect(sessions).toEqual([]);
    });

    it("lists JSONL sessions sorted by mtime descending", async () => {
      const fsMod = await import("fs/promises");
      (fsMod.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
        "old.context.jsonl",
        "new.context.jsonl",
      ]);
      (fsMod.default.stat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ mtime: new Date("2024-01-02T10:00:00Z") })
        .mockResolvedValueOnce({ mtime: new Date("2024-01-01T10:00:00Z") });
      const sessions = await MessageStore.list();
      expect(sessions[0].name).toBe("old");
      expect(sessions[1].name).toBe("new");
    });
  });

  describe("load", () => {
    it("returns parsed JSONL session data", async () => {
      const fsMod = await import("fs/promises");
      const header = JSON.stringify({
        model: "claude-3",
        totalTokens: 1000,
        msgCount: 1,
      });
      const msg = JSON.stringify({ role: "user", content: "hello" });
      (fsMod.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        `${header}\n${msg}\n`,
      );
      const data = await MessageStore.load("test-session");
      expect(data?.model).toBe("claude-3");
      expect(data?.messages).toHaveLength(1);
      expect(data?.totalTokens).toBe(1000);
    });

    it("skips malformed lines", async () => {
      const fsMod = await import("fs/promises");
      const header = JSON.stringify({
        model: "test",
        totalTokens: 0,
        msgCount: 2,
      });
      (fsMod.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        `${header}\n{bad json}\n{"role":"user","content":"ok"}\n`,
      );
      const data = await MessageStore.load("test");
      expect(data?.messages).toHaveLength(1);
    });

    it("falls back to legacy .json format", async () => {
      const fsMod = await import("fs/promises");
      (fsMod.default.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockResolvedValueOnce(
          JSON.stringify({ model: "legacy", messages: [], totalTokens: 0 }),
        );
      const data = await MessageStore.load("old-session");
      expect(data?.model).toBe("legacy");
    });

    it("returns null when not found", async () => {
      const fsMod = await import("fs/promises");
      (fsMod.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT"),
      );
      const data = await MessageStore.load("nonexistent");
      expect(data).toBeNull();
    });
  });

  describe("getTurns", () => {
    it("returns a shallow copy of turns", () => {
      const store = new MessageStore();
      store.addUserMessage("test");
      const turns = store.getTurns();
      expect(turns).toHaveLength(1);

      // Mutating the returned array should not affect the store
      turns.pop();
      expect(store.getTurns()).toHaveLength(1);
    });
  });

  describe("removeLastTurn", () => {
    it("removes the last turn if predicate matches", () => {
      const store = new MessageStore();
      store.addUserMessage("msg1");
      store.addUserMessage("msg2");

      const removed = store.removeLastTurn(
        (t) => t.role === "user" && t.content === "msg2",
      );
      expect(removed).toBe(true);
      expect(store.getTurns()).toHaveLength(1);
      expect(store.getTurns()[0].content).toBe("msg1");
    });

    it("does not remove if predicate fails", () => {
      const store = new MessageStore();
      store.addUserMessage("msg1");

      const removed = store.removeLastTurn(
        (t) => t.role === "user" && t.content === "other",
      );
      expect(removed).toBe(false);
      expect(store.getTurns()).toHaveLength(1);
    });

    it("does nothing on empty store", () => {
      const store = new MessageStore();
      const removed = store.removeLastTurn(() => true);
      expect(removed).toBe(false);
    });
  });

  describe("setTurns", () => {
    it("writes JSONL via tmp+rename", async () => {
      const fsMod = await import("fs/promises");
      const store = new MessageStore();
      store.setSessionName("test");
      store.addUserMessage("hello");
      store.setMeta({ model: "claude-3", totalTokens: 100 });
      await store.save();
      expect(fsMod.default.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.any(String),
      );
      expect(fsMod.default.rename).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.stringContaining("test.context.jsonl"),
      );
    });
  });

  describe("delete", () => {
    it("attempts to delete both JSONL and legacy .json", async () => {
      const fsMod = await import("fs/promises");
      await MessageStore.delete("test-session");
      expect(fsMod.default.unlink).toHaveBeenCalledTimes(2);
    });
  });

  describe("rename", () => {
    it("renames JSONL session files", async () => {
      const fsMod = await import("fs/promises");
      await MessageStore.rename("old-name", "new-name");
      expect(fsMod.default.rename).toHaveBeenCalledWith(
        expect.stringContaining("old-name.context.jsonl"),
        expect.stringContaining("new-name.context.jsonl"),
      );
    });
  });
});
