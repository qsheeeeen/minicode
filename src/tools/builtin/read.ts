import fs from "fs/promises";
import path from "path";
import type { LLMMediaType } from "../../core/blocks.js";
import type {
  ToolDef,
  ToolRunResult,
  ToolExecutionContext,
} from "../registry.js";

const IMAGE_EXTENSIONS: Record<string, LLMMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Providers cap image payloads around 5 MB — refuse beyond that rather
 *  than bloat every subsequent request with data the API will reject. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function imageMediaType(filePath: string): LLMMediaType | undefined {
  return IMAGE_EXTENSIONS[path.extname(filePath).toLowerCase()];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

async function readImage(
  filePath: string,
  mediaType: LLMMediaType,
  vision: boolean,
): Promise<ToolRunResult> {
  try {
    const stat = await fs.stat(filePath);
    const label = `[image: ${filePath} (${mediaType}, ${formatBytes(stat.size)})]`;

    if (!vision) {
      return {
        outcome: "success",
        result: `${label} Model does not support vision; image content not loaded.`,
      };
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      return {
        outcome: "error",
        reason: `${filePath} is ${formatBytes(stat.size)} — images larger than ${formatBytes(MAX_IMAGE_BYTES)} are not supported.`,
      };
    }

    const base64 = (await fs.readFile(filePath)).toString("base64");
    return {
      outcome: "success",
      result: label,
      images: [{ mediaType, base64 }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { outcome: "error", reason: msg };
  }
}

export const readTool: ToolDef = {
  name: "Read",
  description:
    "Read the contents of a file. Supports text files and images (png/jpg/jpeg/gif/webp — sent to the model when it supports vision). Defaults to first 2000 lines. Use offset/limit for large files.",
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
  ): Promise<ToolRunResult> => {
    try {
      const path = args.path as string;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;

      const mediaType = imageMediaType(path);
      if (mediaType) {
        return readImage(
          path,
          mediaType,
          context?.config.model.supportsVision() ?? false,
        );
      }

      const content = await fs.readFile(path, "utf-8");
      const lines = content.split("\n");
      const start = (offset || 1) - 1;
      const end = limit ? start + limit : lines.length;
      const result = lines.slice(start, end).join("\n");
      return { outcome: "success", result: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outcome: "error", reason: msg };
    }
  },
};
