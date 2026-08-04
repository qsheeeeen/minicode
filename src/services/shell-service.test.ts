import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ShellService } from "./shell-service.js";

describe("ShellService", () => {
  it("runs commands in the configured cwd", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.run("printf hello");

    expect(result.exitCode).toBe(0);
    expect(service.formatResult(result)).toBe("hello");
  });

  it("formats non-zero exits", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.run("sh -c 'echo nope >&2; exit 7'");

    expect(result.exitCode).toBe(7);
    expect(service.formatResult(result)).toContain("Exit code 7");
  });

  it("supports synchronous shell execution for route handling", () => {
    const service = new ShellService({ cwd: process.cwd() });

    expect(typeof service.runSync("printf ok")).toBe("string");
  });

  it("runs an executable with explicit args (no shell)", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.runProcess("printf", ["hello"]);

    expect(result.exitCode).toBe(0);
    expect(service.formatResult(result)).toBe("hello");
  });

  it("does not shell-interpret args passed to runProcess", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.runProcess("python3", [
      "-c",
      "print('$HOME')",
    ]);

    expect(service.formatResult(result)).toBe("$HOME");
  });

  it("honors a cwd override for runProcess", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-test-"));
    try {
      const service = new ShellService({ cwd: process.cwd() });
      await fs.writeFile(path.join(baseDir, "marker.txt"), "in-place");

      const result = await service.runProcess(
        "python3",
        ["-c", "print(open('marker.txt').read().strip())"],
        { cwd: baseDir },
      );

      expect(service.formatResult(result)).toBe("in-place");
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
