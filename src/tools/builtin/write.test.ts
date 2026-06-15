import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeTool } from "./write.js";

function makeContext() {
  return {
    services: {
      fs: {
        writeText: vi.fn().mockResolvedValue({
          path: "/workspace/test.txt",
          beforeExists: false,
          oldText: "",
          newText: "hello world",
          ranges: [{ start: 0, oldText: "", newText: "hello world" }],
        }),
      },
    },
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
    it("writes content to file", async () => {
      const context = makeContext();

      const result = await writeTool.execute(
        {
          path: "test.txt",
          content: "hello world",
        },
        context,
      );

      expect(result.output).toBe("Wrote test.txt");
      expect(context.services.fs.writeText).toHaveBeenCalledWith(
        "test.txt",
        "hello world",
      );
      expect(context.changeJournal.recordChange).toHaveBeenCalledWith(
        2,
        "/workspace/test.txt",
        "write",
        false,
        [{ start: 0, oldText: "", newText: "hello world" }],
      );
    });

    it("returns error on failure", async () => {
      const context = makeContext();
      context.services.fs.writeText.mockRejectedValue(new Error("EACCES"));

      const result = await writeTool.execute(
        {
          path: "/root/file.txt",
          content: "hello",
        },
        context,
      );

      expect(result.output).toContain("EACCES");
      expect(context.changeJournal.recordChange).not.toHaveBeenCalled();
    });
  });
});
