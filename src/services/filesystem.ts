import fs from "fs/promises";
import path from "path";

export interface FileSystemServiceOpts {
  readonly workspaceRoot: string;
  readonly allowOutsideWorkspace?: boolean;
}

export interface EditTextResult {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly content: string;
  readonly count: number;
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

  async writeText(inputPath: string, content: string): Promise<string> {
    const resolved = this.resolvePath(inputPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return resolved;
  }

  async editText(
    inputPath: string,
    oldText: string,
    newText: string,
    replaceAll?: boolean,
  ): Promise<EditTextResult> {
    const resolved = this.resolvePath(inputPath);
    let content = await fs.readFile(resolved, "utf-8");
    const count = content.split(oldText).length - 1;
    if (count === 0) {
      throw new Error("oldText not found in file");
    }
    if (!replaceAll && count > 1) {
      throw new Error(
        `oldText found ${count} times. Set replaceAll=true to replace all occurrences, or make oldText more specific to match exactly once.`,
      );
    }
    content = replaceAll
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    await fs.writeFile(resolved, content, "utf-8");
    return { path: resolved, oldText, newText, content, count };
  }

  private isInsideWorkspace(resolvedPath: string): boolean {
    const relative = path.relative(this.workspaceRoot, resolvedPath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }
}

export function createDefaultFileSystemService(): FileSystemService {
  return new FileSystemService({ workspaceRoot: process.cwd() });
}
