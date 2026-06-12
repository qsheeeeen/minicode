import { spawn } from "child_process";
import type { ToolDef, ToolResult, ToolExecutionContext } from "../registry.js";
import { register } from "../registry.js";

function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export const shellTool: ToolDef = {
  name: "Shell",
  description:
    "Execute a shell command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.",
  requiresPermission: true,
  readOnly: false,
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string" },
      timeout: { type: "number" },
    },
    required: ["command"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    try {
      const command = args.command as string;
      const timeout = args.timeout as number | undefined;
      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn(command, [], { shell: true });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (d) => {
          stdout += stripAnsiCodes(d.toString());
        });
        proc.stderr?.on("data", (d) => {
          stderr += stripAnsiCodes(d.toString());
        });

        if (timeout) {
          setTimeout(() => proc.kill(), timeout * 1000);
        }

        if (context?.signal?.aborted) {
          proc.kill();
          resolve("Aborted");
          return;
        }
        context?.signal?.addEventListener("abort", () => {
          proc.kill();
        });

        proc.on("close", (code) => {
          if (context?.signal?.aborted) {
            resolve("Aborted");
          } else if (code === 0) {
            resolve(stdout || stderr);
          } else {
            reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
          }
        });
      });
      return { output: output.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(shellTool);
