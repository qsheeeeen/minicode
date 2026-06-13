import { describe, it, expect, vi, beforeEach } from "vitest";
import { editTool } from "./edit.js";

function makeContext() {
  return {
    services: {
      fs: {
        editText: vi.fn().mockResolvedValue({
          path: "/workspace/test.txt",
          oldText: "world",
          newText: "minicode",
          content: "hello minicode",
          count: 1,
        }),
      },
    },
  } as any;
}

describe("editTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("replaces oldText with newText", async () => {
      const context = makeContext();

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "world",
          newText: "minicode",
        },
        context,
      );

      expect(result.output).toContain("Edited test.txt");
      expect(context.services.fs.editText).toHaveBeenCalledWith(
        "test.txt",
        "world",
        "minicode",
        undefined,
      );
    });

    it("passes replaceAll to the file system service", async () => {
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

      expect(context.services.fs.editText).toHaveBeenCalledWith(
        "test.txt",
        "foo",
        "baz",
        true,
      );
    });

    it("returns edit errors", async () => {
      const context = makeContext();
      context.services.fs.editText.mockRejectedValue(
        new Error("oldText not found in file"),
      );

      const result = await editTool.execute(
        {
          path: "test.txt",
          oldText: "notfound",
          newText: "replacement",
        },
        context,
      );

      expect(result.output).toContain("oldText not found");
    });
  });
});
