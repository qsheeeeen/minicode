import {
  createDefaultFileSystemService,
  type FileSystemService,
} from "../../services/filesystem.js";
import { generateDiffSummary } from "../../utils/diff.js";
import type { ToolDef, ToolExecutionContext, ToolResult } from "../registry.js";
import { register } from "../registry.js";

function getFileSystem(context?: ToolExecutionContext): FileSystemService {
  return context?.services?.fs ?? createDefaultFileSystemService();
}

export const editTool: ToolDef = {
  name: "Edit",
  description:
    "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
  requiresPermission: true,
  readOnly: false,
  trackChanges: true,
  changeOp: "edit",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
      replaceAll: {
        type: "boolean",
        description:
          "Replace all occurrences (default: false, replaces first only)",
      },
    },
    required: ["path", "oldText", "newText"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    try {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      const replaceAll = args.replaceAll as boolean | undefined;
      await getFileSystem(context).editText(path, oldText, newText, replaceAll);
      const diffLines = generateDiffSummary(path, oldText, newText);
      const headerLine = diffLines.find((l) => l.type === "header");
      const diffText = diffLines
        .filter((l) => l.type !== "header")
        .map((l) => {
          const prefix =
            l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
          return `${String(l.lineNum).padStart(4)} ${prefix} ${l.content}`;
        })
        .join("\n");
      const stats = headerLine ? ` (${headerLine.content})` : "";
      return { output: `Edited ${path}${stats}\n${diffText}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  },
};
register(editTool);
