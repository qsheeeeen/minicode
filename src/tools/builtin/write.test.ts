import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeTool } from "./write.js";
import { createCapabilities } from "../registry.js";
import { ChangeJournalCapability } from "../capabilities.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeContext() {
  const journal = { recordChange: vi.fn().mockResolvedValue(undefined) };
  const context = {
    activeUserMessageOrdinal: 2,
    capabilities: createCapabilities([[ChangeJournalCapability, journal]]),
  } as any;
  return { context, journal };
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
      const { context, journal } = makeContext();

      const result = await writeTool.execute(
        {
          path: "test.txt",
          content: "hello world",
        },
        context,
      );

      expect(unwrapSuccess(result)).toBe("Wrote test.txt");
      expect(fs.mkdir).toHaveBeenCalledWith(".", { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "hello world",
        "utf-8",
      );
      expect(journal.recordChange).toHaveBeenCalledWith(
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
      const { context, journal } = makeContext();

      await writeTool.execute(
        {
          path: "dir/test.txt",
          content: "new",
        },
        context,
      );

      expect(fs.mkdir).toHaveBeenCalledWith("dir", { recursive: true });
      expect(journal.recordChange).toHaveBeenCalledWith(
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
      const { context, journal } = makeContext();

      const result = await writeTool.execute(
        {
          path: "/root/file.txt",
          content: "hello",
        },
        context,
      );

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("EACCES");
      expect(journal.recordChange).not.toHaveBeenCalled();
    });
  });
});
