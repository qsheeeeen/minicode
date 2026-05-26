import { describe, it, expect, vi, beforeEach } from "vitest";
import { editTool } from "./edit.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("editTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("replaces oldText with newText", async () => {
      const fs = await import("fs/promises");
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "hello world",
      );
      const result = await editTool.execute({
        path: "test.txt",
        oldText: "world",
        newText: "minicode",
      });
      expect(result.output).toContain("Edited test.txt");
      expect(fs.default.writeFile).toHaveBeenCalledWith(
        "test.txt",
        "hello minicode",
        "utf-8",
      );
    });

    it("replaces first occurrence only", async () => {
      const fs = await import("fs/promises");
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "foo bar foo",
      );
      await editTool.execute({
        path: "test.txt",
        oldText: "foo",
        newText: "baz",
      });
      const written = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(written).toBe("baz bar foo");
    });

    it("throws when oldText not found", async () => {
      const fs = await import("fs/promises");
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        "hello world",
      );
      const result = await editTool.execute({
        path: "test.txt",
        oldText: "notfound",
        newText: "replacement",
      });
      expect(result.output).toContain("oldText not found");
    });

    it("returns error when file not found", async () => {
      const fs = await import("fs/promises");
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT"),
      );
      const result = await editTool.execute({
        path: "nonexistent.txt",
        oldText: "old",
        newText: "new",
      });
      expect(result.output).toContain("ENOENT");
    });
  });
});
