import type { ShellService } from "./shell-service.js";

export type ClipboardResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface ClipboardServiceOpts {
  readonly shell: ShellService;
  /** Test seams; default to the real platform and environment. */
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
}

type ClipboardCommand = {
  executable: string;
  args: string[];
  timeoutMs?: number;
};

/** clip.exe decodes its stdin with the system ANSI code page, so UTF-8
 *  text (any non-ASCII locale) arrives mangled. PowerShell can be told to
 *  read stdin as UTF-8 and set the clipboard from it; argv is passed
 *  verbatim (no shell), so the script needs no escaping. */
const POWERSHELL_UTF8_SCRIPT =
  "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard ([Console]::In.ReadToEnd())";

/** macOS / Windows each have exactly one system clipboard utility. */
function darwinCandidates(): ClipboardCommand[] {
  return [{ executable: "pbcopy", args: [] }];
}

function windowsCandidates(): ClipboardCommand[] {
  return [{ executable: "clip", args: [] }];
}

/** Linux: Wayland first, then X11; inside WSL, the Windows clipboard wins —
 *  via PowerShell (UTF-8-safe) first, plain clip.exe (ASCII-only safe) as
 *  the fallback when PowerShell is unavailable. */
function linuxCandidates(env: Record<string, string | undefined>): ClipboardCommand[] {
  const wsl = env.WSL_DISTRO_NAME !== undefined || env.WSLENV !== undefined;
  const x11: ClipboardCommand[] = [
    { executable: "wl-copy", args: [] },
    { executable: "xclip", args: ["-selection", "clipboard"] },
    { executable: "xsel", args: ["--clipboard", "--input"] },
  ];
  if (!wsl) return x11;
  return [
    {
      executable: "powershell.exe",
      args: ["-NoProfile", "-Command", POWERSHELL_UTF8_SCRIPT],
      timeoutMs: 15000,
    },
    { executable: "clip.exe", args: [] },
    ...x11,
  ];
}

/**
 * ClipboardService — copies text to the system clipboard by piping it
 * through the platform's clipboard utility via the shell port. A utility
 * that answers successfully once is remembered and tried first afterwards;
 * if it later disappears the probe runs again from the top.
 */
export class ClipboardService {
  private readonly shell: ShellService;
  private readonly platform: NodeJS.Platform;
  private readonly env: Record<string, string | undefined>;
  private resolved?: ClipboardCommand;

  constructor(opts: ClipboardServiceOpts) {
    this.shell = opts.shell;
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
  }

  private candidates(): ClipboardCommand[] {
    if (this.platform === "darwin") return darwinCandidates();
    if (this.platform === "win32") return windowsCandidates();
    return linuxCandidates(this.env);
  }

  async copy(text: string): Promise<ClipboardResult> {
    const order = this.resolved
      ? [this.resolved, ...this.candidates().filter((c) => c !== this.resolved)]
      : this.candidates();

    const failures: string[] = [];
    for (const candidate of order) {
      const result = await this.shell.runProcess(candidate.executable, candidate.args, {
        timeoutMs: candidate.timeoutMs ?? 5000,
        stdinData: text,
      });
      if (result.exitCode === 0) {
        this.resolved = candidate;
        return { ok: true };
      }
      failures.push(
        `${candidate.executable}: ${result.stderr || `exit code ${result.exitCode}`}`,
      );
    }
    this.resolved = undefined;
    const guide =
      this.platform === "linux"
        ? " (install wl-copy, xclip, or xsel)"
        : "";
    return { ok: false, reason: `No clipboard utility available${guide}: ${failures.join("; ")}` };
  }
}
