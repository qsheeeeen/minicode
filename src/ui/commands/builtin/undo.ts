import type { CommandHandler } from "../registry.js";

export const undoCommand: CommandHandler = {
  name: "undo",
  description: "Rollback to a previous user message",
  handler: async (_args, ctx): Promise<void> => {
    if (ctx.isAgentRunning()) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(Agent is running, please wait)",
        timestamp: new Date(),
      });
      return;
    }

    const userMessages = ctx.context.getUserMessages();

    if (userMessages.length === 0) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(Nothing to rollback)",
        timestamp: new Date(),
      });
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
      changeJournal: ctx.changeJournal,
      context: ctx.context,
      reportStatus: ctx.sessionManager.reportStatus.bind(ctx.sessionManager),
    });
  },
};
