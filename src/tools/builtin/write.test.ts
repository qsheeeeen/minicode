import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeTool } from "./write.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
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

describe("writeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("writes content to file and records a created file", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("not found"), { code: "ENOENT" }),
      );
      const context = makeContext();

      const result = await writeTool.execute(
        {
          path: "test.txt",
          content: "hello world",
        },
        context,
      );

      expect(result.result).toBe("Wrote test.txt");
      expect(fs.mkdir).toHaveBeenCalledWith(".", { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "hello world",
        "utf-8",
      );
      expect(context.changeJournal.recordChange).toHaveBeenCalledWith(
        2,
        "test.txt",
        "write",
        false,
        [{ start: 0, oldText: "", newText: "hello world" }],
      );
    });

    it("records existing file content for overwrite", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("old");
      const context = makeContext();

      await writeTool.execute(
        {
          path: "dir/test.txt",
          content: "new",
        },
        context,
      );

      expect(fs.mkdir).toHaveBeenCalledWith("dir", { recursive: true });
      expect(context.changeJournal.recordChange).toHaveBeenCalledWith(
        2,
        "dir/test.txt",
        "write",
        true,
        [{ start: 0, oldText: "old", newText: "new" }],
      );
    });

    it("returns error on failure", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("EACCES"),
      );
      const context = makeContext();

      const result = await writeTool.execute(
        {
          path: "/root/file.txt",
          content: "hello",
        },
        context,
      );

      expect(result.result).toContain("EACCES");
      expect(context.changeJournal.recordChange).not.toHaveBeenCalled();
    });
  });
});
