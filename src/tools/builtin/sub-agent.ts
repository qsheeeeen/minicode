// Thin tool: resolves the SubAgentSpawnerCapability and forwards. All service
// wiring lives in app/sub-agent-runtime.ts.

import type {
  ToolDef,
  ToolRunResult,
  ToolExecutionContext,
} from "../registry.js";
import { listAgentTypes, DEFAULT_AGENT_TYPE } from "../agent-types.js";
import { SubAgentSpawnerCapability } from "../capabilities.js";

const availableTypesDescription = (): string =>
  listAgentTypes()
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join("\n");

export const agentTool: ToolDef = {
  name: "SubAgent",
  description:
    "Delegate a sub-task to an independent sub-agent and return its summary. " +
    "Pick the agentType that matches the task:\n" +
    availableTypesDescription(),
  readOnly: false,
  requires: ["agentRegistry"],
  input_schema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string" as const,
        description: "The specific task to delegate to the sub-agent",
      },
      agentType: {
        type: "string" as const,
        description: `Kind of sub-agent (defaults to ${DEFAULT_AGENT_TYPE}).`,
        enum: ["researcher", "reviewer", "planner", "worker"],
      },
    },
    required: ["task"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolRunResult> => {
    if (!context) {
      return {
        outcome: "error",
        reason: "Sub-agent spawning is not configured",
      };
    }
    const task = args.task as string;
    const agentType =
      (args.agentType as string | undefined) ?? DEFAULT_AGENT_TYPE;

    const spawnSubAgent = context.capabilities.get(SubAgentSpawnerCapability);
    if (!spawnSubAgent) {
      return {
        outcome: "error",
        reason: "Sub-agent spawning is not configured",
      };
    }

    return spawnSubAgent({ task, agentType, parent: context });
  },
};
