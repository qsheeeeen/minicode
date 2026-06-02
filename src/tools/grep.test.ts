import { describe, it, expect, vi, beforeEach } from "vitest";
import { grepTool } from "./grep.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("grepTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when pattern is missing", async () => {
    const result = await grepTool.execute({});
    expect(result.output).toBe("Error: pattern is required");
  });

  it("returns matches on success", async () => {
    const { spawn } = await import("child_process");
    const mockProc = {
      stdout: {
        on: vi.fn((evt, cb) => {
          if (evt === "data") cb(Buffer.from("file.ts:1:match"));
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => {
        if (evt === "close") cb(0);
      }),
      kill: vi.fn(),
    };
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

    const result = await grepTool.execute({ pattern: "TODO" });
    expect(result.output).toBe("file.ts:1:match");
  });

  it("returns 'No matches found' when grep finds nothing", async () => {
    const { spawn } = await import("child_process");
    const mockProc = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => {
        if (evt === "close") cb(1);
      }),
      kill: vi.fn(),
    };
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

    const result = await grepTool.execute({ pattern: "nonexistent" });
    expect(result.output).toBe("No matches found");
  });

  it("passes correct args for case-insensitive search", async () => {
    const { spawn } = await import("child_process");
    const mockProc = {
      stdout: {
        on: vi.fn((evt, cb) => {
          if (evt === "data") cb(Buffer.from("match"));
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => {
        if (evt === "close") cb(0);
      }),
      kill: vi.fn(),
    };
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

    await grepTool.execute({ pattern: "test", ignore_case: true, path: "src" });
    expect(spawn).toHaveBeenCalledWith(
      "grep",
      expect.arrayContaining(["-i"]),
      expect.any(Object),
    );
  });

  it("includes file glob when specified", async () => {
    const { spawn } = await import("child_process");
    const mockProc = {
      stdout: {
        on: vi.fn((evt, cb) => {
          if (evt === "data") cb(Buffer.from("match"));
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => {
        if (evt === "close") cb(0);
      }),
      kill: vi.fn(),
    };
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

    await grepTool.execute({ pattern: "import", include: "*.ts" });
    expect(spawn).toHaveBeenCalledWith(
      "grep",
      expect.arrayContaining(["--include=*.ts"]),
      expect.any(Object),
    );
  });

  it("uses non-recursive flag when recursive is false", async () => {
    const { spawn } = await import("child_process");
    const mockProc = {
      stdout: {
        on: vi.fn((evt, cb) => {
          if (evt === "data") cb(Buffer.from("match"));
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => {
        if (evt === "close") cb(0);
      }),
      kill: vi.fn(),
    };
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

    await grepTool.execute({ pattern: "test", recursive: false });
    const callArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(callArgs).not.toContain("-r");
  });
});
