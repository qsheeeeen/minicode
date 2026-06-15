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

    const result = await service.writeText("dir/file.txt", "hello");

    expect(result.path).toBe(path.join(root, "dir/file.txt"));
    expect(result.beforeExists).toBe(false);
    expect(result.ranges).toEqual([
      { start: 0, oldText: "", newText: "hello" },
    ]);
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
    expect(result.ranges).toEqual([
      { start: 0, oldText: "foo", newText: "baz" },
      { start: 8, oldText: "foo", newText: "baz" },
    ]);
    await expect(service.readText("file.txt")).resolves.toBe("baz bar baz");
  });

  it("records existing file content for write as a full replacement", async () => {
    const root = await makeWorkspace();
    const service = new FileSystemService({ workspaceRoot: root });
    await service.writeText("file.txt", "");

    const result = await service.writeText("file.txt", "next");

    expect(result.beforeExists).toBe(true);
    expect(result.ranges).toEqual([
      { start: 0, oldText: "", newText: "next" },
    ]);
    await expect(service.readText("file.txt")).resolves.toBe("next");
  });
});
