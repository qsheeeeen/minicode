import {
  createDefaultShellService,
  type ShellService,
} from "../../services/shell-service.js";
import type { ToolDef, ToolResult, ToolExecutionContext } from "../registry.js";
import { register } from "../registry.js";

function getShell(context?: ToolExecutionContext): ShellService {
  return context?.services?.shell ?? createDefaultShellService();
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
      const shell = getShell(context);
      const result = await shell.run(command, {
        timeoutMs: timeout ? timeout * 1000 : undefined,
        signal: context?.signal,
      });
      return { output: shell.formatResult(result) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(shellTool);
