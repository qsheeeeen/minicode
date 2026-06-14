import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMContext } from "../llm/context.js";

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

  function makeContext(blocks: any[]) {
    const context = new LLMContext();
    context.replaceBlocks(blocks);
    return context;
  }

  describe("rollbackConversation", () => {
    it("truncates conversation and prunes journal", async () => {
      const journal = makeMockJournal([]);
      const context = makeContext([
        { type: "user", text: "first" },
        { type: "text", text: "reply" },
        { type: "user", text: "second" },
        { type: "text", text: "reply2" },
      ]);

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      const result = await executor.rollbackConversation(journal, context, 2);

      expect(context.getBlocks()).toEqual([
        { type: "user", text: "first" },
        { type: "text", text: "reply" },
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
      const context = makeContext([
        { type: "user", text: "first" },
        { type: "user", text: "second" },
        { type: "user", text: "third" },
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

      // Conversation truncated before user message 2
      expect(context.getBlocks()).toEqual([{ type: "user", text: "first" }]);
      // Journal pruned last
      expect(journal.pruneFrom).toHaveBeenCalledWith(2);
    });

    it("returns empty results when no affected entries", async () => {
      const journal = makeMockJournal([
        { turnIdx: 1, path: "a.ts", op: "edit", before: "old", ts: 100 },
      ]);
      const context = makeContext([{ type: "user", text: "first" }]);

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
      const context = makeContext([
        { type: "user", text: "first" },
        { type: "user", text: "second" },
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
