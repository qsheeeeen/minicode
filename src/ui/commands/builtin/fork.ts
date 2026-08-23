import type { CommandHandler } from "../registry.js";
import type { CommandContext } from "../index.js";

function report(
  ctx: CommandContext,
  role: "status" | "error",
  content: string,
): void {
  ctx.sessionManager.reportStatus({ role, content });
}

/** Rewind the context to before a user message — non-destructively: the
 *  tree keeps the old branch, and the next input grows a sibling. This is
 *  /undo's counterpart: undo deletes the subtree, fork keeps it.
 *
 *  "/fork <ordinal>" executes directly (also works headless); bare "/fork"
 *  presents the interactive picker, which feeds a fully parameterized
 *  command back through the input pipeline. */
export const forkCommand: CommandHandler = {
  name: "fork",
  description: "Branch from a previous user message (keeps history)",
  handler: async (args, ctx): Promise<void> => {
    if (ctx.isAgentRunning()) {
      report(ctx, "status", "(Agent is running, please wait)");
      return;
    }

    const userMessages = ctx.context.getUserMessages();
    if (userMessages.length === 0) {
      report(ctx, "status", "(Nothing to fork)");
      return;
    }

    if (args.length === 0) {
      ctx.presentInput({
        type: "fork-picker",
        messageIds: ctx.context.getUserMessageSummaries().map((s) => s.id),
        userMessages,
      });
      return;
    }

    const ordinal = Number(args[0]);
    if (
      !Number.isInteger(ordinal) ||
      ordinal < 1 ||
      ordinal > userMessages.length
    ) {
      report(ctx, "error", `(Invalid message number: ${args[0]})`);
      return;
    }

    // The UI speaks ordinals; the tree speaks stable message ids.
    const target = ctx.context
      .getUserMessageSummaries()
      .find((s) => s.ordinal === ordinal);
    if (!target) {
      report(ctx, "error", `(Invalid message number: ${args[0]})`);
      return;
    }

    const tree = ctx.sessionManager.getTree();
    const entry = tree.get(target.id);
    if (!entry) {
      report(
        ctx,
        "error",
        "(Message is not in the persisted tree — cannot fork)",
      );
      return;
    }

    // Move the leaf to the parent and restore that path as the context.
    // The target's subtree stays in the tree; the next user message starts
    // a sibling branch under the same parent.
    tree.setActiveTurn(entry.parentId);
    ctx.context.replaceBlocks(tree.activePathBlocks());
    // Persist the pointer move — otherwise an exit before the next run
    // would restore the old branch from the file's leaf line.
    await ctx.sessionManager.saveStore(undefined, { final: true });

    report(
      ctx,
      "status",
      `(Forked to before message ${ordinal}; branch kept — next message starts a sibling)`,
    );
  },
};
