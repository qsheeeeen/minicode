import type { ToolDef, ToolRunResult, ToolExecutionContext } from "../registry.js";
import { register } from "../registry.js";

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
  ): Promise<ToolRunResult> => {
    const shell = context?.shell;
    if (!shell) {
      return { success: true, result: "Error: shell service not available" };
    }
    try {
      const command = args.command as string;
      const timeout = args.timeout as number | undefined;
      const result = await shell.run(command, {
        timeoutMs: timeout ? timeout * 1000 : undefined,
        signal: context?.signal,
      });
      return { success: true, result: shell.formatResult(result) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: true, result: msg };
    }
  },
};
register(shellTool);
