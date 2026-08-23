import fs from "fs/promises";
import { generateDiffSummary } from "../../utils/diff.js";
import type {
  ToolDef,
  ToolExecutionContext,
  ToolRunResult,
} from "../registry.js";
import { ChangeJournalCapability } from "../capabilities.js";

interface TextReplacementRange {
  readonly start: number;
  readonly oldText: string;
  readonly newText: string;
}

interface EditTextResult {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly content: string;
  readonly count: number;
  readonly ranges: TextReplacementRange[];
}

function findReplacementRanges(
  content: string,
  oldText: string,
  newText: string,
): TextReplacementRange[] {
  const ranges: TextReplacementRange[] = [];
  let start = content.indexOf(oldText);
  if (start === -1) return ranges;

  ranges.push({ start, oldText, newText });
  let nextSearchStart = start + oldText.length;
  while ((start = content.indexOf(oldText, nextSearchStart)) !== -1) {
    ranges.push({ start, oldText, newText });
    nextSearchStart = start + oldText.length;
  }
  return ranges;
}

function applyReplacementRanges(
  content: string,
  ranges: readonly TextReplacementRange[],
): string {
  let next = content;
  for (const range of [...ranges].reverse()) {
    next =
      next.slice(0, range.start) +
      range.newText +
      next.slice(range.start + range.oldText.length);
  }
  return next;
}

async function editText(
  inputPath: string,
  oldText: string,
  newText: string,
  replaceAll?: boolean,
): Promise<EditTextResult> {
  let content = await fs.readFile(inputPath, "utf-8");
  if (oldText === "") {
    throw new Error("oldText must not be empty");
  }

  const allRanges = findReplacementRanges(content, oldText, newText);
  const count = allRanges.length;
  if (count === 0) {
    throw new Error("oldText not found in file");
  }
  if (!replaceAll && count > 1) {
    throw new Error(
      `oldText found ${count} times. Set replaceAll=true to replace all occurrences, or make oldText more specific to match exactly once.`,
    );
  }
  const ranges = replaceAll ? allRanges : allRanges.slice(0, 1);
  content = applyReplacementRanges(content, ranges);
  await fs.writeFile(inputPath, content, "utf-8");
  return { path: inputPath, oldText, newText, content, count, ranges };
}

async function recordEditChange(
  context: ToolExecutionContext | undefined,
  result: EditTextResult,
): Promise<void> {
  const messageId = context?.activeMessageId;
  const changeJournal = context
    ? context.capabilities.require(ChangeJournalCapability)
    : undefined;
  if (!changeJournal || !messageId) return;
  await changeJournal.recordChange(
    messageId,
    result.path,
    "edit",
    true,
    result.ranges,
  );
}

export const editTool: ToolDef = {
  name: "Edit",
  description:
    "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
  requiresPermission: true,
  readOnly: false,
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
  ): Promise<ToolRunResult> => {
    try {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      const replaceAll = args.replaceAll as boolean | undefined;
      const result = await editText(path, oldText, newText, replaceAll);
      await recordEditChange(context, result);
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
      return {
        outcome: "success",
        result: `Edited ${path}${stats}\n${diffText}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outcome: "error", reason: msg };
    }
  },
};
