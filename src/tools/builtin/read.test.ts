import { describe, it, expect, vi, beforeEach } from "vitest";
import { readTool } from "./read.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";
import type { ToolExecutionContext } from "../registry.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

async function mockReadFile(content: string): Promise<void> {
  const fs = (await import("fs/promises")).default;
  (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(content);
}

async function mockImageFile(sizeBytes: number, base64: string): Promise<void> {
  const fs = (await import("fs/promises")).default;
  (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: sizeBytes });
  (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
    Buffer.from(base64, "base64"),
  );
}

function visionContext(vision: boolean): ToolExecutionContext {
  return {
    config: {
      model: { supportsVision: () => vision },
    },
  } as unknown as ToolExecutionContext;
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

      expect(unwrapSuccess(result)).toBe("file content");
      expect(fs.readFile).toHaveBeenCalledWith("test.txt", "utf-8");
    });

    it("returns error when file not found", async () => {
      const fs = (await import("fs/promises")).default;
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT: no such file"),
      );

      const result = await readTool.execute({ path: "nonexistent.txt" });

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("ENOENT");
    });

    it("slices lines with offset and limit", async () => {
      await mockReadFile("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute({
        path: "test.txt",
        offset: 2,
        limit: 2,
      });

      expect(unwrapSuccess(result)).toBe("line2\nline3");
    });

    it("uses 1-indexed offset", async () => {
      await mockReadFile("line1\nline2\nline3");

      const result = await readTool.execute({ path: "test.txt", offset: 1 });

      expect(unwrapSuccess(result)).toBe("line1\nline2\nline3");
    });

    it("handles offset without limit", async () => {
      await mockReadFile("line1\nline2\nline3\nline4");

      const result = await readTool.execute({ path: "test.txt", offset: 3 });

      expect(unwrapSuccess(result)).toBe("line3\nline4");
    });

    it("handles limit only (no offset)", async () => {
      await mockReadFile("line1\nline2\nline3\nline4\nline5");

      const result = await readTool.execute({ path: "test.txt", limit: 2 });

      expect(unwrapSuccess(result)).toBe("line1\nline2");
    });
  });

  describe("images", () => {
    it("returns image data for a vision model", async () => {
      await mockImageFile(2048, "AAAA");

      const result = await readTool.execute(
        { path: "shot.png" },
        visionContext(true),
      );

      expect(result).toEqual({
        outcome: "success",
        result: "[image: shot.png (image/png, 2KB)]",
        images: [{ mediaType: "image/png", base64: "AAAA" }],
      });
    });

    it("maps jpg to image/jpeg", async () => {
      await mockImageFile(2048, "AAAA");

      const result = await readTool.execute(
        { path: "photo.JPG" },
        visionContext(true),
      );

      expect(result.outcome).toBe("success");
      if (result.outcome !== "success") return;
      expect(result.images?.[0].mediaType).toBe("image/jpeg");
    });

    it("returns a text placeholder without loading data for non-vision models", async () => {
      await mockImageFile(2048, "AAAA");

      const result = await readTool.execute(
        { path: "shot.png" },
        visionContext(false),
      );

      expect(result.outcome).toBe("success");
      if (result.outcome !== "success") return;
      expect(result.images).toBeUndefined();
      expect(result.result).toContain("shot.png");
      expect(result.result).toContain("does not support vision");
      const fs = (await import("fs/promises")).default;
      // Only stat ran — the image bytes were never read into context.
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("defaults to no vision when context is missing", async () => {
      await mockImageFile(2048, "AAAA");

      const result = await readTool.execute({ path: "shot.png" });

      expect(result.outcome).toBe("success");
      if (result.outcome !== "success") return;
      expect(result.images).toBeUndefined();
    });

    it("rejects images over 5MB", async () => {
      await mockImageFile(6 * 1024 * 1024, "AAAA");

      const result = await readTool.execute(
        { path: "big.png" },
        visionContext(true),
      );

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("big.png");
    });
  });
});
