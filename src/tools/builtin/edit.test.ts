import { describe, it, expect, vi, beforeEach } from "vitest";
import { editTool } from "./edit.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeContext() {
  return {
    activeUserMessageOrdinal: 2,
    changeJournal: {
      recordChange: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe("editTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("replaces oldText with newText", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "hello world",
      );
      const context = makeContext();

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "world",
          newText: "minicode",
        },
        context,
      );

      expect(result.result).toContain("Edited test.txt");
      expect(fs.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "hello minicode",
        "utf-8",
      );
      expect(context.changeJournal.recordChange).toHaveBeenCalledWith(
        2,
        "test.txt",
        "edit",
        true,
        [{ start: 6, oldText: "world", newText: "minicode" }],
      );
    });

    it("replaces all occurrences when replaceAll is true", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "foo bar foo",
      );
      const context = makeContext();

      await editTool.execute(
        {
          path: "test.txt",
          oldText: "foo",
          newText: "baz",
          replaceAll: true,
        },
        context,
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "baz bar baz",
        "utf-8",
      );
      expect(context.changeJournal.recordChange).toHaveBeenCalledWith(
        2,
        "test.txt",
        "edit",
        true,
        [
          { start: 0, oldText: "foo", newText: "baz" },
          { start: 8, oldText: "foo", newText: "baz" },
        ],
      );
    });

    it("returns edit errors", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "hello world",
      );
      const context = makeContext();

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "notfound",
          newText: "replacement",
        },
        context,
      );

      expect(result.result).toContain("oldText not found");
      expect(context.changeJournal.recordChange).not.toHaveBeenCalled();
    });
  });
});
