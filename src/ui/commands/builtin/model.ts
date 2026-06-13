import { registerCommand } from "../registry.js";

registerCommand({
  name: "model",
  description: "Switch model/provider",
  handler: async (_args, ctx): Promise<void> => {
    ctx.setInputMode("model-select", {
      providers: ctx.config.providers,
      tiers: ctx.config.tiers,
    });
  },
});
