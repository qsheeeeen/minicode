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

    expect(typeof service.runSync("printf ok")).toBe("string");
  });
});
