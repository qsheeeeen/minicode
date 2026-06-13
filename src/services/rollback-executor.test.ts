import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("RollbackExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockJournal(entries: any[]) {
    return {
      getEntries: vi.fn().mockResolvedValue(entries),
      pruneFrom: vi.fn().mockResolvedValue(undefined),
    } as any;
  }

  function makeMockMessageStore(turns: any[]) {
    return {
      getTurns: vi.fn().mockReturnValue(turns),
      replaceTurns: vi.fn(),
    } as any;
  }

  describe("rollbackConversation", () => {
    it("truncates conversation and prunes journal", async () => {
      const journal = makeMockJournal([]);
      const context = makeMockMessageStore([
        { userText: "first", process: [], assistantText: "reply" },
        { userText: "second", process: [], assistantText: "reply2" },
      ]);

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      const result = await executor.rollbackConversation(journal, context, 2);

      expect(context.replaceTurns).toHaveBeenCalledWith([
        { userText: "first", process: [], assistantText: "reply" },
      ]);
      expect(journal.pruneFrom).toHaveBeenCalledWith(2);
      expect(result.filesRestored).toEqual([]);
      expect(result.filesDeleted).toEqual([]);
    });
  });

  describe("rollbackFilesAndConversation", () => {
    it("restores files then truncates conversation then prunes", async () => {
      const entries = [
        {
          turnIdx: 2,
          path: "a.ts",
          op: "edit",
          before: "old content",
          ts: 100,
        },
        { turnIdx: 3, path: "b.ts", op: "write", before: "", ts: 200 },
      ];
      const journal = makeMockJournal(entries);
      const context = makeMockMessageStore([
        { userText: "first", process: [] },
        { userText: "second", process: [] },
        { userText: "third", process: [] },
      ]);

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      const result = await executor.rollbackFilesAndConversation(
        journal,
        context,
        2,
      );

      // File with before content gets restored
      expect(result.filesRestored).toContain("a.ts");
      // File with empty before gets deleted
      expect(result.filesDeleted).toContain("b.ts");

      const fs = (await import("fs/promises")).default;
      expect(fs.writeFile).toHaveBeenCalledWith("a.ts", "old content", "utf-8");
      expect(fs.unlink).toHaveBeenCalledWith("b.ts");

      // Conversation truncated before turn 2
      expect(context.replaceTurns).toHaveBeenCalledWith([
        { userText: "first", process: [] },
      ]);
      // Journal pruned last
      expect(journal.pruneFrom).toHaveBeenCalledWith(2);
    });

    it("returns empty results when no affected entries", async () => {
      const journal = makeMockJournal([
        { turnIdx: 1, path: "a.ts", op: "edit", before: "old", ts: 100 },
      ]);
      const context = makeMockMessageStore([
        { userText: "first", process: [] },
      ]);

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      const result = await executor.rollbackFilesAndConversation(
        journal,
        context,
        5,
      );

      expect(result.filesRestored).toEqual([]);
      expect(result.filesDeleted).toEqual([]);
    });

    it("uses earliest entry for each file path", async () => {
      const entries = [
        {
          turnIdx: 2,
          path: "a.ts",
          op: "edit",
          before: "first-version",
          ts: 100,
        },
        {
          turnIdx: 3,
          path: "a.ts",
          op: "edit",
          before: "second-version",
          ts: 200,
        },
      ];
      const journal = makeMockJournal(entries);
      const context = makeMockMessageStore([
        { userText: "first", process: [] },
        { userText: "second", process: [] },
      ]);

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      await executor.rollbackFilesAndConversation(journal, context, 2);

      const fs = (await import("fs/promises")).default;
      // Should use the earliest entry (first-version), not second
      expect(fs.writeFile).toHaveBeenCalledWith(
        "a.ts",
        "first-version",
        "utf-8",
      );
    });
  });
});
