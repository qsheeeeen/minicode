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
  /** Written to the child's stdin (then closed) — pipes content through
   *  filter commands (pbcopy, xclip, …) without shell-escaping argv. */
  readonly stdinData?: string;
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

/** Kill the whole process group when available, so `shell: true` commands
 * cannot leave their foreground child running after the shell exits. */
function stopProcess(proc: ReturnType<typeof spawn>): void {
  if (proc.pid && process.platform !== "win32") {
    try {
      process.kill(-proc.pid, "SIGTERM");
      return;
    } catch {
      // The process may already have exited; fall through to ChildProcess.
    }
  }
  proc.kill("SIGTERM");
}

/** Accumulates chunks without re-copying the whole output per chunk; once
 *  the byte cap is reached further chunks are dropped. */
class OutputCollector {
  private parts: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  push(data: Buffer): void {
    if (this.bytes >= this.maxBytes) return;
    const text = stripAnsiCodes(data.toString());
    this.parts.push(text);
    this.bytes += Buffer.byteLength(text, "utf-8");
  }

  result(): string {
    const output = this.parts.join("");
    return Buffer.byteLength(output, "utf-8") <= this.maxBytes
      ? output
      : `${output.slice(0, this.maxBytes)}\n[output truncated]`;
  }
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
        detached: process.platform !== "win32",
      });
      const stdout = new OutputCollector(this.maxOutputBytes);
      const stderr = new OutputCollector(this.maxOutputBytes);
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        stopProcess(proc);
      }, opts.timeoutMs ?? this.defaultTimeoutMs);

      const abort = () => stopProcess(proc);
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

      proc.stdout?.on("data", (d) => stdout.push(d));
      proc.stderr?.on("data", (d) => stderr.push(d));
      if (opts.stdinData !== undefined) {
        proc.stdin?.on("error", () => {}); // EPIPE when the reader exits early
        proc.stdin?.end(opts.stdinData);
      }
      proc.on("close", (code) => {
        clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", abort);
        resolve({
          stdout: stdout.result().trim(),
          stderr: stderr.result().trim(),
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
}
