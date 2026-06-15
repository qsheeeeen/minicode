import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMContext } from "../llm/context.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
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
      pruneFromUserMessage: vi.fn().mockResolvedValue(undefined),
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
      expect(journal.pruneFromUserMessage).toHaveBeenCalledWith(2);
      expect(result.filesRestored).toEqual([]);
      expect(result.filesDeleted).toEqual([]);
    });
  });

  describe("rollbackFilesAndConversation", () => {
    it("reverts edits, deletes created writes, then prunes", async () => {
      const entries = [
        {
          userMessageOrdinal: 2,
          path: "a.ts",
          op: "edit",
          beforeExists: true,
          ranges: [{ start: 0, oldText: "old", newText: "new" }],
          ts: 100,
        },
        {
          userMessageOrdinal: 3,
          path: "b.ts",
          op: "write",
          beforeExists: false,
          ranges: [{ start: 0, oldText: "", newText: "created" }],
          ts: 200,
        },
      ];
      const journal = makeMockJournal(entries);
      const context = makeContext([
        { type: "user", text: "first" },
        { type: "user", text: "second" },
        { type: "user", text: "third" },
      ]);
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "new content",
      );

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      const result = await executor.rollbackFilesAndConversation(
        journal,
        context,
        2,
      );

      expect(result.filesRestored).toContain("a.ts");
      expect(result.filesDeleted).toContain("b.ts");
      expect(fs.writeFile).toHaveBeenCalledWith("a.ts", "old content", "utf-8");
      expect(fs.unlink).toHaveBeenCalledWith("b.ts");
      expect(context.getBlocks()).toEqual([{ type: "user", text: "first" }]);
      expect(journal.pruneFromUserMessage).toHaveBeenCalledWith(2);
    });

    it("returns empty results when no affected entries", async () => {
      const journal = makeMockJournal([
        {
          userMessageOrdinal: 1,
          path: "a.ts",
          op: "edit",
          beforeExists: true,
          ranges: [{ start: 0, oldText: "old", newText: "new" }],
          ts: 100,
        },
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

    it("replays multiple entries for the same file in reverse order", async () => {
      const entries = [
        {
          userMessageOrdinal: 2,
          path: "a.ts",
          op: "edit",
          beforeExists: true,
          ranges: [{ start: 0, oldText: "A", newText: "B" }],
          ts: 100,
        },
        {
          userMessageOrdinal: 3,
          path: "a.ts",
          op: "edit",
          beforeExists: true,
          ranges: [{ start: 0, oldText: "B", newText: "C" }],
          ts: 200,
        },
      ];
      const journal = makeMockJournal(entries);
      const context = makeContext([
        { type: "user", text: "first" },
        { type: "user", text: "second" },
      ]);
      const fs = (await import("fs/promises")).default;
      let fileContent = "C";
      (fs.readFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        return fileContent;
      });
      (fs.writeFile as ReturnType<typeof vi.fn>).mockImplementation(
        async (_path, content) => {
          fileContent = content as string;
        },
      );

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();
      await executor.rollbackFilesAndConversation(journal, context, 2);

      expect(fileContent).toBe("A");
      expect(fs.writeFile).toHaveBeenNthCalledWith(1, "a.ts", "B", "utf-8");
      expect(fs.writeFile).toHaveBeenNthCalledWith(2, "a.ts", "A", "utf-8");
    });

    it("throws on rollback conflicts", async () => {
      const journal = makeMockJournal([
        {
          userMessageOrdinal: 2,
          path: "a.ts",
          op: "edit",
          beforeExists: true,
          ranges: [{ start: 0, oldText: "old", newText: "new" }],
          ts: 100,
        },
      ]);
      const context = makeContext([{ type: "user", text: "first" }]);
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "unexpected",
      );

      const { RollbackExecutor } = await import("./rollback-executor.js");
      const executor = new RollbackExecutor();

      await expect(
        executor.rollbackFilesAndConversation(journal, context, 2),
      ).rejects.toThrow("Rollback conflict");
      expect(journal.pruneFromUserMessage).not.toHaveBeenCalled();
    });
  });
});
