import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./commands/index.js", () => ({
  executeCommand: vi.fn(),
}));

describe("routeInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'none' for empty input", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("", {} as any);
    expect(result).toEqual({ action: "none" });
  });

  it("returns 'none' for whitespace-only input", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("   ", {} as any);
    expect(result).toEqual({ action: "none" });
  });

  it("routes '!' prefix to shell", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("!echo hello", {} as any);
    expect(result).toEqual({ action: "shell", promptText: "echo hello" });
  });

  it("returns 'none' for '!' with no command", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("!", {} as any);
    expect(result).toEqual({ action: "none" });
  });

  it("routes '/' prefix to command", async () => {
    const { executeCommand } = await import("./commands/index.js");
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
      promptText: "command result",
      displayContent: "display",
    });

    const { routeInput } = await import("./routing.js");
    const result = await routeInput("/help", {} as any);
    expect(result).toEqual({
      action: "command",
      promptText: "command result",
      displayContent: "display",
    });
    expect(executeCommand).toHaveBeenCalledWith("help", [], expect.any(Object));
  });

  it("routes command without promptText as plain command", async () => {
    const { executeCommand } = await import("./commands/index.js");
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
    });

    const { routeInput } = await import("./routing.js");
    const result = await routeInput("/clear", {} as any);
    expect(result).toEqual({ action: "command" });
  });

  it("routes plain text to llm", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("hello world", {} as any);
    expect(result).toEqual({ action: "llm", promptText: "hello world" });
  });

  it("trims whitespace from input", async () => {
    const { routeInput } = await import("./routing.js");
    const result = await routeInput("  hello  ", {} as any);
    expect(result).toEqual({ action: "llm", promptText: "hello" });
  });
});
