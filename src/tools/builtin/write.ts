import fs from "fs/promises";
import path from "path";
import type { ToolDef, ToolExecutionContext, ToolRunResult } from "../registry.js";
import { register } from "../registry.js";

interface TextReplacementRange {
  readonly start: number;
  readonly oldText: string;
  readonly newText: string;
}

interface WriteTextResult {
  readonly path: string;
  readonly beforeExists: boolean;
  readonly ranges: TextReplacementRange[];
}

async function writeText(
  inputPath: string,
  content: string,
): Promise<WriteTextResult> {
  let beforeExists = true;
  let oldText = "";
  try {
    oldText = await fs.readFile(inputPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    beforeExists = false;
  }
  await fs.mkdir(path.dirname(inputPath), { recursive: true });
  await fs.writeFile(inputPath, content, "utf-8");
  return {
    path: inputPath,
    beforeExists,
    ranges: [{ start: 0, oldText, newText: content }],
  };
}

async function recordWriteChange(
  context: ToolExecutionContext | undefined,
  result: WriteTextResult,
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
  ): Promise<ToolRunResult> => {
    try {
      const filePath = args.path as string;
      const content = args.content as string;
      const result = await writeText(filePath, content);
      await recordWriteChange(context, result);
      return { success: true, result: `Wrote ${filePath}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: true, result: msg };
    }
  },
};
register(writeTool);
