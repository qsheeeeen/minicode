import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { FileSystemService } from "./filesystem.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "minicode-fs-"));
}

describe("FileSystemService", () => {
  it("reads and writes text inside the workspace", async () => {
    const root = await makeWorkspace();
    const service = new FileSystemService({ workspaceRoot: root });

    const writtenPath = await service.writeText("dir/file.txt", "hello");

    expect(writtenPath).toBe(path.join(root, "dir/file.txt"));
    await expect(service.readText("dir/file.txt")).resolves.toBe("hello");
  });

  it("rejects paths outside the workspace", async () => {
    const root = await makeWorkspace();
    const service = new FileSystemService({ workspaceRoot: root });

    expect(() => service.resolvePath("../outside.txt")).toThrow(
      "Path outside workspace",
    );
  });

  it("can edit text with single or all replacements", async () => {
    const root = await makeWorkspace();
    const service = new FileSystemService({ workspaceRoot: root });
    await service.writeText("file.txt", "foo bar foo");

    await expect(service.editText("file.txt", "foo", "baz")).rejects.toThrow(
      "found 2 times",
    );

    const result = await service.editText("file.txt", "foo", "baz", true);
    expect(result.content).toBe("baz bar baz");
    await expect(service.readText("file.txt")).resolves.toBe("baz bar baz");
  });
});
