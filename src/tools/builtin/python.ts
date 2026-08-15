import { python3Requirement } from "../requirements.js";
import type {
  ToolDef,
  ToolRunResult,
  ToolExecutionContext,
} from "../registry.js";
import { ShellCapability } from "../capabilities.js";

/**
 * Python — direct execution of a code snippet via `python3 -c`, without a
 * shell wrapper. Agents use this instead of `Shell` for ad-hoc Python scripts
 * (no shell quoting, args stay literal).
 */
export const pythonTool: ToolDef = {
  name: "Python",
  description:
    "Execute a Python code snippet directly with python3 -c (no shell wrapper). " +
    "Use this instead of Shell for ad-hoc Python scripts. " +
    "Optionally set 'path' to a working directory (relative to the project root) " +
    "and 'timeout' to a limit in seconds.",
  requires: [python3Requirement],
  requiresPermission: true,
  readOnly: false,
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "Python code to execute",
      },
      path: {
        type: "string",
        description:
          "Working directory for the snippet, relative to the project root (optional)",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (optional)",
      },
    },
    required: ["code"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolRunResult> => {
    const shell = context?.capabilities.get(ShellCapability);
    if (!shell) {
      return { outcome: "error", reason: "shell service not available" };
    }
    try {
      const code = args.code as string;
      const cwd = args.path as string | undefined;
      const timeout = args.timeout as number | undefined;
      const result = await shell.runProcess("python3", ["-c", code], {
        timeoutMs: timeout ? timeout * 1000 : undefined,
        signal: context?.signal,
        cwd,
      });
      return { outcome: "success", result: shell.formatResult(result) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outcome: "error", reason: msg };
    }
  },
};
