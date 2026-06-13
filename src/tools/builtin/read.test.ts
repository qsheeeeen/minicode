import { describe, it, expect, vi, beforeEach } from "vitest";
import { readTool } from "./read.js";

function makeContext(content = "file content") {
  return {
    services: {
      fs: {
        readText: vi.fn().mockResolvedValue(content),
      },
    },
  } as any;
}

describe("readTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("reads file content", async () => {
      const context = makeContext("file content");

      const result = await readTool.execute({ path: "test.txt" }, context);

      expect(result.output).toBe("file content");
      expect(context.services.fs.readText).toHaveBeenCalledWith("test.txt");
    });

    it("returns error when file not found", async () => {
      const context = makeContext();
      context.services.fs.readText.mockRejectedValue(
        new Error("ENOENT: no such file"),
      );

      const result = await readTool.execute(
        { path: "nonexistent.txt" },
        context,
      );

      expect(result.output).toContain("ENOENT");
    });

    it("slices lines with offset and limit", async () => {
      const context = makeContext("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute(
        {
          path: "test.txt",
          offset: 2,
          limit: 2,
        },
        context,
      );

      expect(result.output).toBe("line2\nline3");
    });

    it("uses 1-indexed offset", async () => {
      const context = makeContext("line1\nline2\nline3");

      const result = await readTool.execute(
        { path: "test.txt", offset: 1 },
        context,
      );

      expect(result.output).toBe("line1\nline2\nline3");
    });

    it("handles offset without limit", async () => {
      const context = makeContext("line1\nline2\nline3\nline4");

      const result = await readTool.execute(
        { path: "test.txt", offset: 3 },
        context,
      );

      expect(result.output).toBe("line3\nline4");
    });

    it("handles limit only (no offset)", async () => {
      const context = makeContext("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute(
        { path: "test.txt", limit: 2 },
        context,
      );

      expect(result.output).toBe("line1\nline2");
    });
  });
});
