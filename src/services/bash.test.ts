import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

describe("runBash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed output on success", async () => {
    const { execSync } = await import("child_process");
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue("hello world  ");

    const { runBash } = await import("./bash.js");
    const result = runBash("echo hello");
    expect(result).toBe("hello world");
  });

  it("returns '(no output)' for empty stdout", async () => {
    const { execSync } = await import("child_process");
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

    const { runBash } = await import("./bash.js");
    const result = runBash("true");
    expect(result).toBe("(no output)");
  });

  it("returns error message on exception", async () => {
    const { execSync } = await import("child_process");
    (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("command failed");
    });

    const { runBash } = await import("./bash.js");
    const result = runBash("bad_cmd");
    expect(result).toBe("Error: command failed");
  });
});
