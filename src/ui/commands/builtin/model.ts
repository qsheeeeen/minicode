import { registerCommand } from "../registry.js";

registerCommand({
  name: "model",
  description: "Switch model/provider",
  handler: async (_args, ctx): Promise<void> => {
    ctx.presentInput({
      type: "model-picker",
      providers: ctx.config.providers,
      tiers: ctx.config.tiers,
    });
  },
});
