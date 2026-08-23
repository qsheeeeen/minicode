import { describe, it, expect, vi } from "vitest";
import { ClipboardService } from "./clipboard.js";
import type { ShellResult, ShellService } from "./shell-service.js";

function mockShell(
  results: Record<string, ShellResult | "spawn-error">,
): ShellService {
  return {
    runProcess: vi.fn(async (executable: string) => {
      const result = results[executable];
      if (result === undefined) {
        return { stdout: "", stderr: "", exitCode: null, timedOut: false, aborted: false };
      }
      return result === "spawn-error"
        ? { stdout: "", stderr: "spawn failed", exitCode: null, timedOut: false, aborted: false }
        : result;
    }),
  } as unknown as ShellService;
}

const OK: ShellResult = { stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false };

describe("ClipboardService.copy", () => {
  it("pipes text through stdin to pbcopy on darwin", async () => {
    const shell = mockShell({ pbcopy: OK });
    const service = new ClipboardService({ shell, platform: "darwin", env: {} });

    const result = await service.copy("hello");
    expect(result).toEqual({ ok: true });
    expect(shell.runProcess).toHaveBeenCalledWith(
      "pbcopy",
      [],
      expect.objectContaining({ stdinData: "hello" }),
    );
  });

  it("tries candidates in order and succeeds on a later one", async () => {
    const shell = mockShell({
      wlcopy_placeholder: OK,
      xclip: OK,
    });
    // No wl-copy binary: falls through to xclip with selection args.
    const service = new ClipboardService({
      shell,
      platform: "linux",
      env: { DISPLAY: ":0" },
    });

    const result = await service.copy("hello");
    expect(result).toEqual({ ok: true });
    expect(shell.runProcess).toHaveBeenCalledWith(
      "xclip",
      ["-selection", "clipboard"],
      expect.objectContaining({ stdinData: "hello" }),
    );
  });

  it("uses UTF-8-safe powershell first inside WSL", async () => {
    const shell = mockShell({ "powershell.exe": OK });
    const service = new ClipboardService({
      shell,
      platform: "linux",
      env: { WSL_DISTRO_NAME: "Ubuntu" },
    });

    const result = await service.copy("你好");
    expect(result).toEqual({ ok: true });
    const [executable, args, opts] = (
      shell.runProcess as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(executable).toBe("powershell.exe");
    expect(args).toEqual(["-NoProfile", "-Command", expect.any(String)]);
    expect((args as string[])[2]).toContain("InputEncoding");
    expect(opts).toMatchObject({ stdinData: "你好" });
  });

  it("falls back to clip.exe when powershell is missing inside WSL", async () => {
    const shell = mockShell({ "clip.exe": OK });
    const service = new ClipboardService({
      shell,
      platform: "linux",
      env: { WSL_DISTRO_NAME: "Ubuntu" },
    });

    const result = await service.copy("hello");
    expect(result).toEqual({ ok: true });
    const executables = (shell.runProcess as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(executables).toEqual(["powershell.exe", "clip.exe"]);
  });

  it("reports failure with every candidate's reason", async () => {
    const shell = mockShell({}); // every candidate exits non-zero / ENOENT
    const service = new ClipboardService({ shell, platform: "linux", env: {} });

    const result = await service.copy("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("wl-copy");
      expect(result.reason).toContain("xclip");
      expect(result.reason).toContain("xsel");
    }
  });

  it("reuses the candidate that succeeded before", async () => {
    const shell = mockShell({ xsel: OK });
    const service = new ClipboardService({
      shell,
      platform: "linux",
      env: {},
    });

    await service.copy("one");
    await service.copy("two");
    const calls = (shell.runProcess as ReturnType<typeof vi.fn>).mock.calls;
    // The second call goes straight to xsel — no re-probing of wl-copy/xclip.
    expect(calls[3]).toEqual([
      "xsel",
      ["--clipboard", "--input"],
      expect.objectContaining({ stdinData: "two" }),
    ]);
  });
});
