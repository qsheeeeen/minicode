import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { pythonTool } from "./python.js";
import { ShellCapability } from "../capabilities.js";
import { createCapabilities } from "../registry.js";
import { ShellService } from "../../services/shell-service.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";

function makeContext(shell?: ShellService) {
  return {
    capabilities: createCapabilities(shell ? [[ShellCapability, shell]] : []),
    signal: undefined,
  } as any;
}

describe("pythonTool", () => {
  it("returns error when shell service is not available", async () => {
    const result = await pythonTool.execute(
      { code: "print(1)" },
      makeContext(),
    );
    expect(result.outcome).toBe("error");
    expect(unwrapError(result)).toContain("not available");
  });

  it("runs a python snippet and returns stdout", async () => {
    const shell = new ShellService({ cwd: process.cwd() });

    const result = await pythonTool.execute(
      { code: "print(6 * 7)" },
      makeContext(shell),
    );

    expect(result.outcome).toBe("success");
    expect(unwrapSuccess(result)).toBe("42");
  });

  it("reports runtime errors via the exit code", async () => {
    const shell = new ShellService({ cwd: process.cwd() });

    const result = await pythonTool.execute(
      { code: "raise ValueError('boom')" },
      makeContext(shell),
    );

    expect(result.outcome).toBe("success");
    expect(unwrapSuccess(result)).toContain("Exit code 1");
    expect(unwrapSuccess(result)).toContain("boom");
  });

  it("honors the working directory", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "python-tool-"));
    try {
      const shell = new ShellService({ cwd: process.cwd() });
      await fs.writeFile(path.join(baseDir, "marker.txt"), "from-dir");

      const result = await pythonTool.execute(
        { code: "print(open('marker.txt').read().strip())", path: baseDir },
        makeContext(shell),
      );

      expect(unwrapSuccess(result)).toBe("from-dir");
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
