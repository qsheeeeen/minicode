import { execSync, spawn } from "child_process";

export interface ShellServiceOpts {
  readonly cwd: string;
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ShellRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class ShellService {
  private readonly cwd: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(opts: ShellServiceOpts) {
    this.cwd = opts.cwd;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30000;
    this.maxOutputBytes = opts.maxOutputBytes ?? 200000;
  }

  async run(command: string, opts: ShellRunOptions = {}): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve) => {
      const proc = spawn(command, [], { shell: true, cwd: this.cwd });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const append = (target: "stdout" | "stderr", data: Buffer) => {
        const next = this.truncate(
          (target === "stdout" ? stdout : stderr) +
            stripAnsiCodes(data.toString()),
        );
        if (target === "stdout") stdout = next;
        else stderr = next;
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs ?? this.defaultTimeoutMs);

      const abort = () => proc.kill();
      if (opts.signal?.aborted) abort();
      opts.signal?.addEventListener("abort", abort, { once: true });

      proc.stdout?.on("data", (d) => append("stdout", d));
      proc.stderr?.on("data", (d) => append("stderr", d));
      proc.on("close", (code) => {
        clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", abort);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
          timedOut,
          aborted: opts.signal?.aborted ?? false,
        });
      });
    });
  }

  runSync(command: string, timeoutMs?: number): string {
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: timeoutMs ?? this.defaultTimeoutMs,
        cwd: this.cwd,
      });
      return this.truncate(stripAnsiCodes(output)).trim() || "(no output)";
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  formatResult(result: ShellResult): string {
    if (result.aborted) return "Aborted";
    const output = result.stdout || result.stderr;
    if (result.timedOut) return `Timed out\n${output}`.trim();
    if (result.exitCode === 0) return output;
    return `Exit code ${result.exitCode}: ${output}`;
  }

  private truncate(output: string): string {
    if (Buffer.byteLength(output, "utf-8") <= this.maxOutputBytes)
      return output;
    return `${output.slice(0, this.maxOutputBytes)}\n[output truncated]`;
  }
}

export function createDefaultShellService(): ShellService {
  return new ShellService({ cwd: process.cwd() });
}
