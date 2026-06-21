import { describe, it, expect, vi, beforeEach } from "vitest";
import { readTool } from "./read.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

async function mockReadFile(content: string): Promise<void> {
  const fs = (await import("fs/promises")).default;
  (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(content);
}

describe("readTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("reads file content", async () => {
      await mockReadFile("file content");

      const result = await readTool.execute({ path: "test.txt" });
      const fs = (await import("fs/promises")).default;

      expect(result.result).toBe("file content");
      expect(fs.readFile).toHaveBeenCalledWith("test.txt", "utf-8");
    });

    it("returns error when file not found", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT: no such file"),
      );

      const result = await readTool.execute({ path: "nonexistent.txt" });

      expect(result.result).toContain("ENOENT");
    });

    it("slices lines with offset and limit", async () => {
      await mockReadFile("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute({
        path: "test.txt",
        offset: 2,
        limit: 2,
      });

      expect(result.result).toBe("line2\nline3");
    });

    it("uses 1-indexed offset", async () => {
      await mockReadFile("line1\nline2\nline3");

      const result = await readTool.execute({ path: "test.txt", offset: 1 });

      expect(result.result).toBe("line1\nline2\nline3");
    });

    it("handles offset without limit", async () => {
      await mockReadFile("line1\nline2\nline3\nline4");

      const result = await readTool.execute({ path: "test.txt", offset: 3 });

      expect(result.result).toBe("line3\nline4");
    });

    it("handles limit only (no offset)", async () => {
      await mockReadFile("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute({ path: "test.txt", limit: 2 });

      expect(result.result).toBe("line1\nline2");
    });
  });
});
