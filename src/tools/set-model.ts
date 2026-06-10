import type { ToolDef, ToolResult, ToolExecutionContext } from "./registry.js";
import { ModelFactory } from "../llm/model.js";
import { register } from "./registry.js";

export const setModelTool: ToolDef = {
  name: "SetModel",
  description:
    "Switch the current conversation to the model mapped to a tier. Looks up config.tiers[tier] and switches both the running agent and persisted config to that model.",
  readOnly: false,
  input_schema: {
    type: "object" as const,
    properties: {
      tier: {
        type: "string",
        description: 'The model tier: "pro" or "flash"',
      },
    },
    required: ["tier"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const tier = String(args.tier);
    const { loadConfig, setModel } =
      await import("../config.js");
    const config = await loadConfig();
    const modelSpec = config.tiers?.[tier];
    if (!modelSpec) {
      return { output: `Error: No model mapped to tier ${tier}.` };
    }

    const factory = new ModelFactory(config.providers ?? {});
    const newModel = factory.fromSpec(modelSpec);
    if (!newModel) {
      return {
        output: `Error: Could not resolve "${modelSpec}" for tier ${tier}.`,
      };
    }

    const agent = context?.registry?.get(context.currentAgentId || "1")?.agent;
    if (agent) {
      agent.setModel(newModel);
    }
    await setModel(modelSpec);
    return { output: `Switched to ${tier}: ${modelSpec}` };
  },
};
register(setModelTool);
