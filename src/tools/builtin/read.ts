import {
  createDefaultFileSystemService,
  type FileSystemService,
} from "../../services/filesystem.js";
import type { ToolDef, ToolExecutionContext, ToolResult } from "../registry.js";
import { register } from "../registry.js";

function getFileSystem(context?: ToolExecutionContext): FileSystemService {
  return context?.services?.fs ?? createDefaultFileSystemService();
}

export const readTool: ToolDef = {
  name: "Read",
  description:
    "Read the contents of a file. Supports text files. Defaults to first 2000 lines. Use offset/limit for large files.",
  readOnly: true,
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Path to the file" },
      offset: {
        type: "number",
        description: "Line number to start from (1-indexed)",
      },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    try {
      const path = args.path as string;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      const content = await getFileSystem(context).readText(path);
      const lines = content.split("\n");
      const start = (offset || 1) - 1;
      const end = limit ? start + limit : lines.length;
      const result = lines.slice(start, end).join("\n");
      return { output: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(readTool);
