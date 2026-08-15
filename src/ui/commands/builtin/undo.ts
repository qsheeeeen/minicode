import type { CommandHandler } from "../registry.js";
import type { CommandContext } from "../index.js";
import { RollbackExecutor } from "../../../services/rollback-executor.js";

const SCOPES = ["conversation", "both"] as const;
type Scope = (typeof SCOPES)[number];

function report(
  ctx: CommandContext,
  role: "status" | "error",
  content: string,
): void {
  ctx.sessionManager.reportStatus({ role, content, timestamp: new Date() });
}

export const undoCommand: CommandHandler = {
  name: "undo",
  description: "Rollback to a previous user message",
  handler: async (args, ctx): Promise<void> => {
    if (ctx.isAgentRunning()) {
      report(ctx, "status", "(Agent is running, please wait)");
      return;
    }

    const userMessages = ctx.context.getUserMessages();
    if (userMessages.length === 0) {
      report(ctx, "status", "(Nothing to rollback)");
      return;
    }

    // "/undo <ordinal> [scope]" executes directly (also works headless);
    // bare "/undo" presents the interactive picker, which feeds a fully
    // parameterized command back through the input pipeline.
    if (args.length > 0) {
      const ordinal = Number(args[0]);
      const scope = (args[1] ?? "conversation") as Scope;

      if (
        !Number.isInteger(ordinal) ||
        ordinal < 1 ||
        ordinal > userMessages.length
      ) {
        report(ctx, "error", `(Invalid message number: ${args[0]})`);
        return;
      }
      if (!SCOPES.includes(scope)) {
        report(
          ctx,
          "error",
          `(Invalid scope "${scope}": expected conversation or both)`,
        );
        return;
      }

      const executor = new RollbackExecutor();
      const outcome =
        scope === "both"
          ? await executor.rollbackFilesAndConversation(
              ctx.changeJournal,
              ctx.context,
              ordinal,
            )
          : await executor.rollbackConversation(
              ctx.changeJournal,
              ctx.context,
              ordinal,
            );

      if (!outcome.ok) {
        const { filesRestored, filesDeleted } = outcome.partial;
        const partialNote =
          filesRestored.length + filesDeleted.length > 0
            ? ` (${filesRestored.length} restored, ${filesDeleted.length} deleted before failure)`
            : "";
        report(
          ctx,
          "error",
          `(Rollback failed: ${outcome.reason}${partialNote})`,
        );
        return;
      }

      const summary: string[] = [];
      if (scope === "both") {
        if (outcome.result.filesRestored.length > 0) {
          summary.push(
            `restored ${outcome.result.filesRestored.length} file(s)`,
          );
        }
        if (outcome.result.filesDeleted.length > 0) {
          summary.push(`deleted ${outcome.result.filesDeleted.length} file(s)`);
        }
      }
      summary.push("conversation rolled back");
      report(ctx, "status", `(Rollback: ${summary.join(", ")})`);
      return;
    }

    const entriesByUserMessageMap =
      await ctx.changeJournal.getEntriesByUserMessage();
    const entriesByUserMessage = Array.from(
      entriesByUserMessageMap.entries(),
    ).map(([userMessageOrdinal, entries]) => ({ userMessageOrdinal, entries }));

    ctx.presentInput({
      type: "rollback-picker",
      totalUserMessages: userMessages.length,
      entriesByUserMessage,
      userMessages,
    });
  },
};
