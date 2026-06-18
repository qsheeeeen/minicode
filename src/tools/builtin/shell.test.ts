import { describe, it, expect, vi, beforeEach } from "vitest";
import { shellTool } from "./shell.js";

function makeContext(output = "output") {
  return {
    shell: {
      run: vi.fn().mockResolvedValue({
        stdout: output,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        aborted: false,
      }),
      formatResult: vi.fn().mockReturnValue(output),
    },
    signal: undefined,
  } as any;
}

describe("shellTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("returns formatted shell output on success", async () => {
      const context = makeContext("output");

      const result = await shellTool.execute(
        { command: "echo hello" },
        context,
      );

      expect(result.output).toBe("output");
      expect(context.shell.run).toHaveBeenCalledWith("echo hello", {
        timeoutMs: undefined,
        signal: undefined,
      });
    });

    it("converts timeout seconds to milliseconds", async () => {
      const context = makeContext("output");

      await shellTool.execute({ command: "sleep 1", timeout: 2 }, context);

      expect(context.shell.run).toHaveBeenCalledWith("sleep 1", {
        timeoutMs: 2000,
        signal: undefined,
      });
    });

    it("returns errors from the shell service", async () => {
      const context = makeContext();
      context.shell.run.mockRejectedValue(new Error("boom"));

      const result = await shellTool.execute({ command: "bad" }, context);

      expect(result.output).toContain("boom");
    });
  });
});
