import { spawn } from "child_process";
import path from "path";

export interface ShellServiceOpts {
  readonly cwd: string;
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ShellRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ShellProcessOptions extends ShellRunOptions {
  /** Working directory override; relative paths resolve against the service cwd. */
  readonly cwd?: string;
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
    return this.spawnAndCollect(command, [], {
      ...opts,
      shell: true,
      cwd: this.cwd,
    });
  }

  /** Run an executable with explicit args, no shell interpretation. */
  async runProcess(
    executable: string,
    args: string[],
    opts: ShellProcessOptions = {},
  ): Promise<ShellResult> {
    return this.spawnAndCollect(executable, args, {
      ...opts,
      shell: false,
      cwd: opts.cwd ? path.resolve(this.cwd, opts.cwd) : this.cwd,
    });
  }

  private spawnAndCollect(
    command: string,
    args: string[],
    opts: ShellRunOptions & { shell: boolean; cwd: string },
  ): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve) => {
      const proc = spawn(command, args, {
        shell: opts.shell,
        cwd: opts.cwd,
      });
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

      // Missing executables (ENOENT) surface as an 'error' event; without a
      // listener the failure escapes as an uncaught exception and kills the
      // whole process instead of becoming a tool result.
      proc.on("error", (err) => {
        clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", abort);
        resolve({
          stdout: "",
          stderr: err.message,
          exitCode: null,
          timedOut: false,
          aborted: false,
        });
      });

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

  formatResult(result: ShellResult): string {
    if (result.aborted) return "Aborted";
    const output = result.stdout || result.stderr;
    if (result.timedOut) {
      return output ? `Timed out\n${output}` : "(timed out, no output)";
    }
    if (output) {
      return result.exitCode === 0
        ? output
        : `Exit code ${result.exitCode}: ${output}`;
    }
    return `(no output, exit code ${result.exitCode})`;
  }

  private truncate(output: string): string {
    if (Buffer.byteLength(output, "utf-8") <= this.maxOutputBytes)
      return output;
    return `${output.slice(0, this.maxOutputBytes)}\n[output truncated]`;
  }
}
