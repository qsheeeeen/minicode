import type { CommandHandler } from "../registry.js";

/** Copy the last assistant reply to the system clipboard. The reply text is
 *  a derived view of the context (LLMContext.getLastAssistantText) — this
 *  command owns no copy of the conversation. */
export const copyCommand: CommandHandler = {
  name: "copy",
  description: "Copy the last assistant reply to the clipboard",
  handler: async (_args, ctx): Promise<void> => {
    const text = ctx.context.getLastAssistantText();
    if (!text) {
      ctx.sessionManager.reportStatus({
        role: "error",
        content: "Nothing to copy: the last assistant reply has no text.",
      });
      return;
    }

    const result = await ctx.clipboard.copy(text);
    ctx.sessionManager.reportStatus(
      result.ok
        ? {
            role: "status",
            content: `Copied ${text.length} characters to the clipboard.`,
          }
        : { role: "error", content: result.reason },
    );
  },
};
