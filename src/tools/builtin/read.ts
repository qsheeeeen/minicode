import fs from "fs/promises";
import type { ToolDef, ToolResult } from "../registry.js";
import { register } from "../registry.js";

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
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const path = args.path as string;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      const content = await fs.readFile(path, "utf-8");
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
