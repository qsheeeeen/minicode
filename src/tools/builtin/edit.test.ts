import { describe, it, expect, vi, beforeEach } from "vitest";
import { editTool } from "./edit.js";
import { createCapabilities } from "../registry.js";
import { ChangeJournalCapability } from "../capabilities.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";

vi.mock("fs/promises", () => ({
  default: {
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
      const { context, journal } = makeContext();

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "world",
          newText: "minicode",
        },
        context,
      );

      expect(unwrapSuccess(result)).toContain("Edited test.txt");
      expect(fs.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "hello minicode",
        "utf-8",
      );
      expect(journal.recordChange).toHaveBeenCalledWith(
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
      const { context, journal } = makeContext();

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
      expect(journal.recordChange).toHaveBeenCalledWith(
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
      const { context, journal } = makeContext();

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "notfound",
          newText: "replacement",
        },
        context,
      );

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("oldText not found");
      expect(journal.recordChange).not.toHaveBeenCalled();
    });
  });
});
