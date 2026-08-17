import { describe, it, expect } from "vitest";
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

    expect(typeof service.run).toBe("function");
  });

  it("runs an executable with explicit args (no shell)", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.runProcess("printf", ["hello"]);

    expect(result.exitCode).toBe(0);
    expect(service.formatResult(result)).toBe("hello");
  });

  it("returns a failed result instead of throwing when the executable is missing", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.runProcess(
      "minicode-no-such-executable-xyz",
      [],
    );

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("minicode-no-such-executable-xyz");
  });

  it("does not shell-interpret args passed to runProcess", async () => {
    const service = new ShellService({ cwd: process.cwd() });

    const result = await service.runProcess("python3", [
      "-c",
      "print('$HOME')",
    ]);

    expect(service.formatResult(result)).toBe("$HOME");
  });
});
