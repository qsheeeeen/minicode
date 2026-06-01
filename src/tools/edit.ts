import fs from "fs/promises";
import { generateDiffSummary } from "../utils/diff.js";
import type { ToolDef, ToolResult } from "./registry.js";
import { register } from "./registry.js";

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
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      const replaceAll = args.replaceAll as boolean | undefined;
      let content = await fs.readFile(path, "utf-8");
      const count = content.split(oldText).length - 1;
      if (count === 0) {
        throw new Error("oldText not found in file");
      }
      if (!replaceAll && count > 1) {
        throw new Error(
          `oldText found ${count} times. Set replaceAll=true to replace all occurrences, or make oldText more specific to match exactly once.`,
        );
      }
      const separator = oldText;
      content = replaceAll
        ? content.split(separator).join(newText)
        : content.replace(separator, newText);
      await fs.writeFile(path, content, "utf-8");
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
