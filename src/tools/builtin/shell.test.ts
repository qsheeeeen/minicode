import { describe, it, expect, vi, beforeEach } from "vitest";
import { shellTool } from "./shell.js";
import { createCapabilities } from "../registry.js";
import { ShellCapability } from "../capabilities.js";
import { unwrapSuccess, unwrapError } from "../../testing/index.js";

function makeContext(output = "output") {
  const shell = {
    run: vi.fn().mockResolvedValue({
      stdout: output,
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
    }),
    formatResult: vi.fn().mockReturnValue(output),
  };
  const context = {
    capabilities: createCapabilities([[ShellCapability, shell]]),
    signal: undefined,
  } as any;
  return { context, shell };
}

describe("shellTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("returns formatted shell output on success", async () => {
      const { context, shell } = makeContext("output");

      const result = await shellTool.execute(
        { command: "echo hello" },
        context,
      );

      expect(unwrapSuccess(result)).toBe("output");
      expect(shell.run).toHaveBeenCalledWith("echo hello", {
        timeoutMs: undefined,
        signal: undefined,
      });
    });

    it("converts timeout seconds to milliseconds", async () => {
      const { context, shell } = makeContext("output");

      await shellTool.execute({ command: "sleep 1", timeout: 2 }, context);

      expect(shell.run).toHaveBeenCalledWith("sleep 1", {
        timeoutMs: 2000,
        signal: undefined,
      });
    });

    it("returns errors from the shell service", async () => {
      const { context, shell } = makeContext();
      shell.run.mockRejectedValue(new Error("boom"));

      const result = await shellTool.execute({ command: "bad" }, context);

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("boom");
    });
  });
});
