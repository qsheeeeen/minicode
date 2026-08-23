import { describe, it, expect, vi } from "vitest";
import { copyCommand } from "./copy.js";
import type { CommandContext } from "../index.js";
import type { LLMContext } from "../../../core/context.js";
import type { SessionManager } from "../../../services/session-manager.js";

function makeContext(blocksText: string): {
  ctx: CommandContext;
  reportStatus: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
} {
  const reportStatus = vi.fn();
  const copy = vi.fn(async () => ({ ok: true as const }));
  const context = {
    getLastAssistantText: () => blocksText,
  } as unknown as LLMContext;
  const ctx = {
    context,
    clipboard: { copy },
    sessionManager: { reportStatus },
  } as unknown as CommandContext;
  return { ctx, reportStatus, copy };
}

describe("copyCommand", () => {
  it("copies the last assistant text and reports the size", async () => {
    const { ctx, reportStatus, copy } = makeContext("hello world");

    await copyCommand.handler!([], ctx);

    expect(copy).toHaveBeenCalledWith("hello world");
    expect(reportStatus).toHaveBeenCalledWith({
      role: "status",
      content: "Copied 11 characters to the clipboard.",
    });
  });

  it("reports an error when there is no assistant text", async () => {
    const { ctx, reportStatus, copy } = makeContext("");

    await copyCommand.handler!([], ctx);

    expect(copy).not.toHaveBeenCalled();
    expect(reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "error" }),
    );
  });

  it("reports the clipboard failure reason", async () => {
    const { ctx, reportStatus } = makeContext("hello");
    (ctx.clipboard.copy as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "No clipboard utility available",
    });

    await copyCommand.handler!([], ctx);

    expect(reportStatus).toHaveBeenCalledWith({
      role: "error",
      content: "No clipboard utility available",
    });
  });
});
