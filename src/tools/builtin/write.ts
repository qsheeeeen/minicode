import {
  createDefaultFileSystemService,
  type FileSystemService,
} from "../../services/filesystem.js";
import type { ToolDef, ToolExecutionContext, ToolResult } from "../registry.js";
import { register } from "../registry.js";

function getFileSystem(context?: ToolExecutionContext): FileSystemService {
  return context?.services?.fs ?? createDefaultFileSystemService();
}

async function recordWriteChange(
  context: ToolExecutionContext | undefined,
  result: Awaited<ReturnType<FileSystemService["writeText"]>>,
): Promise<void> {
  const userMessageOrdinal = context?.activeUserMessageOrdinal ?? 0;
  if (!context?.changeJournal || userMessageOrdinal <= 0) return;
  await context.changeJournal.recordChange(
    userMessageOrdinal,
    result.path,
    "write",
    result.beforeExists,
    result.ranges,
  );
}

export const writeTool: ToolDef = {
  name: "Write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  requiresPermission: true,
  readOnly: false,
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
      const result = await getFileSystem(context).writeText(filePath, content);
      await recordWriteChange(context, result);
      return { output: `Wrote ${filePath}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(writeTool);
