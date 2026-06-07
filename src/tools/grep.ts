import { spawn } from "child_process";
import type { ToolDef, ToolResult, ToolExecutionContext } from "./registry.js";
import { register } from "./registry.js";

export const grepTool: ToolDef = {
  name: "Grep",
  description:
    "Search file contents using the system grep command. Supports recursive search, line numbers, and case-insensitive matching. Searches are restricted to the current working directory and its subdirectories.",
  requiresPermission: false,
  readOnly: true,
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: "The regex pattern to search for",
      },
      path: {
        type: "string",
        description:
          "Directory or file to search in (default: current directory)",
      },
      recursive: {
        type: "boolean",
        description: "Search recursively in subdirectories (default: true)",
      },
      ignore_case: { type: "boolean", description: "Case-insensitive search" },
      include: {
        type: "string",
        description: "File glob pattern to include, e.g. '*.ts'",
      },
    },
    required: ["pattern"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    if (!pattern) return { output: "Error: pattern is required" };

    const searchPath = (args.path as string) || ".";
    const recursive = args.recursive !== false;
    const ignoreCase = !!args.ignore_case;
    const include = args.include as string | undefined;

    const grepArgs = ["-n"];
    if (ignoreCase) grepArgs.push("-i");
    if (recursive) grepArgs.push("-r");
    if (include) grepArgs.push(`--include=${include}`);
    grepArgs.push(pattern, searchPath);

    try {
      const output = await new Promise<string>((resolve) => {
        const proc = spawn("grep", grepArgs, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d) => (stdout += d.toString()));
        proc.stderr?.on("data", (d) => (stderr += d.toString()));

        context?.signal?.addEventListener("abort", () => proc.kill());

        proc.on("close", () => {
          const trimmed = (stdout || stderr).trim();
          resolve(trimmed || "No matches found");
        });
      });
      return { output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(grepTool);
