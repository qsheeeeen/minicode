import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./commands/index.js", () => ({
  executeCommand: vi.fn(),
}));

import { createDefaultRouter } from "./routing.js";

describe("InputRouter.route", () => {
  const router = createDefaultRouter();
  const cmdContext = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'none' for empty input", async () => {
    const result = await router.route("", cmdContext);
    expect(result).toEqual({ action: "none" });
  });

  it("returns 'none' for whitespace-only input", async () => {
    const result = await router.route("   ", cmdContext);
    expect(result).toEqual({ action: "none" });
  });

  it("routes '!' prefix to shell", async () => {
    const result = await router.route("!echo hello", cmdContext);
    expect(result).toEqual({ action: "shell", promptText: "echo hello" });
  });

  it("returns 'none' for '!' with no command", async () => {
    const result = await router.route("!", cmdContext);
    expect(result).toEqual({ action: "none" });
  });

  it("routes '/' prefix to command", async () => {
    const { executeCommand } = await import("./commands/index.js");
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
      promptText: "command result",
      displayContent: "display",
    });

    const result = await router.route("/help", cmdContext);
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

    const result = await router.route("/clear", cmdContext);
    expect(result).toEqual({ action: "command" });
  });

  it("routes plain text to llm", async () => {
    const result = await router.route("hello world", cmdContext);
    expect(result).toEqual({ action: "llm", promptText: "hello world" });
  });

  it("trims whitespace from input", async () => {
    const result = await router.route("  hello  ", cmdContext);
    expect(result).toEqual({ action: "llm", promptText: "hello" });
  });
});
