import { registerCommand } from "../registry.js";

registerCommand({
  name: "undo",
  description: "Rollback to a previous conversation turn",
  handler: async (_args, ctx): Promise<void> => {
    if (ctx.agent.isRunning) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(Agent is running, please wait)",
        timestamp: new Date(),
      });
      return;
    }

    const turns = ctx.context.getTurns();
    const userMessages = turns.map((t) => t.userText);

    if (userMessages.length === 0) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(Nothing to rollback)",
        timestamp: new Date(),
      });
      return;
    }

    const entriesByTurnMap = await ctx.changeJournal.getEntriesByTurn();
    const entriesByTurn = Array.from(entriesByTurnMap.entries()).map(
      ([turnIdx, entries]) => ({ turnIdx, entries }),
    );

    ctx.setInputMode("undo", {
      totalTurns: userMessages.length,
      entriesByTurn,
      userMessages,
      changeJournal: ctx.changeJournal,
      context: ctx.context,
      reportStatus: ctx.sessionManager.reportStatus.bind(ctx.sessionManager),
    });
  },
});
