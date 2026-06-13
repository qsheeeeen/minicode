import {
  createDefaultFileSystemService,
  type FileSystemService,
} from "../../services/filesystem.js";
import type { ToolDef, ToolExecutionContext, ToolResult } from "../registry.js";
import { register } from "../registry.js";

function getFileSystem(context?: ToolExecutionContext): FileSystemService {
  return context?.services?.fs ?? createDefaultFileSystemService();
}

export const writeTool: ToolDef = {
  name: "Write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  requiresPermission: true,
  readOnly: false,
  trackChanges: true,
  changeOp: "write",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    try {
      const filePath = args.path as string;
      const content = args.content as string;
      await getFileSystem(context).writeText(filePath, content);
      return { output: `Wrote ${filePath}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(writeTool);
