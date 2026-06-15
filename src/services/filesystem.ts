import fs from "fs/promises";
import path from "path";

export interface FileSystemServiceOpts {
  readonly workspaceRoot: string;
  readonly allowOutsideWorkspace?: boolean;
}

export interface TextReplacementRange {
  readonly start: number;
  readonly oldText: string;
  readonly newText: string;
}

export interface EditTextResult {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly content: string;
  readonly count: number;
  readonly ranges: TextReplacementRange[];
}

export interface WriteTextResult {
  readonly path: string;
  readonly beforeExists: boolean;
  readonly oldText: string;
  readonly newText: string;
  readonly ranges: TextReplacementRange[];
}

export class FileSystemService {
  private readonly workspaceRoot: string;
  private readonly allowOutsideWorkspace: boolean;

  constructor(opts: FileSystemServiceOpts) {
    this.workspaceRoot = path.resolve(opts.workspaceRoot);
    this.allowOutsideWorkspace = opts.allowOutsideWorkspace ?? false;
  }

  resolvePath(inputPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, inputPath);
    if (!this.allowOutsideWorkspace && !this.isInsideWorkspace(resolved)) {
      throw new Error(`Path outside workspace: ${resolved}`);
    }
    return resolved;
  }

  async readText(inputPath: string): Promise<string> {
    return fs.readFile(this.resolvePath(inputPath), "utf-8");
  }

  async writeText(
    inputPath: string,
    content: string,
  ): Promise<WriteTextResult> {
    const resolved = this.resolvePath(inputPath);
    let beforeExists = true;
    let oldText = "";
    try {
      oldText = await fs.readFile(resolved, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      beforeExists = false;
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return {
      path: resolved,
      beforeExists,
      oldText,
      newText: content,
      ranges: [{ start: 0, oldText, newText: content }],
    };
  }

  async editText(
    inputPath: string,
    oldText: string,
    newText: string,
    replaceAll?: boolean,
  ): Promise<EditTextResult> {
    const resolved = this.resolvePath(inputPath);
    let content = await fs.readFile(resolved, "utf-8");
    if (oldText === "") {
      throw new Error("oldText must not be empty");
    }

    const allRanges = this.findReplacementRanges(content, oldText, newText);
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
    content = this.applyReplacementRanges(content, ranges);
    await fs.writeFile(resolved, content, "utf-8");
    return { path: resolved, oldText, newText, content, count, ranges };
  }

  private isInsideWorkspace(resolvedPath: string): boolean {
    const relative = path.relative(this.workspaceRoot, resolvedPath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  private findReplacementRanges(
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

  private applyReplacementRanges(
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
}

export function createDefaultFileSystemService(): FileSystemService {
  return new FileSystemService({ workspaceRoot: process.cwd() });
}
