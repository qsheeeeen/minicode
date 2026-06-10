import type { ToolDef, ToolResult, ToolExecutionContext } from "./registry.js";
import type { AgentConfig } from "../agent.js";
import type { MessageParam, ContentBlock } from "../messages.js";
import { Agent } from "../agent.js";
import { register } from "./registry.js";

export const agentTool: ToolDef = {
  name: "SubAgent",
  description:
    "Delegate a sub-task to an independent read-only agent. The sub-agent has access to read-only, non-interactive tools only and returns a concise summary.",
  readOnly: false,
  requires: ["agentRegistry"],
  input_schema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string" as const,
        description: "The specific task to delegate to the sub-agent",
      },
      tier: {
        type: "string" as const,
        description:
          'Optional: run the sub-agent with the model mapped to this tier ("pro" or "flash"). Overrides the parent model.',
      },
    },
    required: ["task"],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const task = args.task as string;
    const tier = args.tier as string | undefined;
    const registry = context?.registry;
    const config = context?.config;
    const parentId = context?.currentAgentId || "1";

    if (!registry) {
      return { output: "Error: AgentRegistry not available" };
    }

    if (!config) {
      return { output: "Error: Agent config not available" };
    }

    const subId = registry.allocateSubId();

    const subConfig: AgentConfig = {
      model: config.model,
      userPrompt: config.userPrompt,
      subAgentMode: true,
      agentRegistry: registry,
      currentAgentId: subId,
    };

    // Override model from tier mapping
    if (tier) {
      const { loadConfig } = await import("../config.js");
      const { ModelFactory } = await import("../llm/model.js");
      const appConfig = await loadConfig();
      const modelSpec = appConfig.tiers?.[tier];
      if (modelSpec) {
        const factory = new ModelFactory(appConfig.providers ?? {});
        const tierModel = factory.fromSpec(modelSpec);
        if (tierModel) {
          subConfig.model = tierModel;
        }
      }
    }

    const subAgent = new Agent(subConfig);

    context?.signal?.addEventListener("abort", () => {
      subAgent.abort();
    });

    registry.register({
      id: subId,
      type: "sub",
      agent: subAgent,
      status: "running",
      task,
      parentId,
    });

    // Notify via parent agent's store
    const parentSession = registry.get(parentId);
    if (parentSession) {
      const taskPreview = task.length > 40 ? task.slice(0, 40) + "..." : task;
      parentSession.agent.getStore().addStatus({
        role: "status",
        content: `[Agent #${subId} started: ${taskPreview}]`,
        timestamp: new Date(),
      });
    }

    // Track progress during execution
    let toolCallCount = 0;
    subAgent.tokenCount$.subscribe((count: number) => {
      registry.updateProgress(subId, { tokenCount: count });
    });
    subAgent.getStore().onChange(() => {
      const turns = subAgent.getStore().getTurns();
      let tc = 0;
      for (const turn of turns) {
        if (turn.role === "assistant" && Array.isArray(turn.content)) {
          for (const block of turn.content) {
            if (block.type === "tool_use") tc++;
          }
        }
      }
      if (tc !== toolCallCount) {
        toolCallCount = tc;
        registry.updateProgress(subId, { toolCalls: tc });
      }
    });

    try {
      await subAgent.run(task);
      const turns = subAgent.getStore().getTurns();
      const finalResponse = extractFinalResponse(turns);
      const summary = generateSummary(turns);
      registry.updateProgress(subId, {
        tokenCount: subAgent.getTokenCount(),
        toolCalls: toolCallCount,
      });
      registry.updateStatus(subId, "completed");
      registry.updateSummary(subId, summary);
      registry.remove(subId);

      const output = finalResponse || `Agent #${subId} completed: ${summary}`;
      return { output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      registry.updateStatus(subId, "error");
      registry.updateSummary(subId, `Error: ${errorMsg}`);
      registry.remove(subId);

      return { output: `Agent #${subId} failed: ${errorMsg}` };
    }
  },
};

function extractFinalResponse(turns: MessageParam[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "assistant" && Array.isArray(turn.content)) {
      for (const block of turn.content as ContentBlock[]) {
        if (block.type === "text" && block.text.trim()) {
          return block.text.trim();
        }
      }
    }
  }
  return null;
}

function generateSummary(turns: MessageParam[]): string {
  let toolCallCount = 0;

  for (const turn of turns) {
    if (turn.role === "assistant" && Array.isArray(turn.content)) {
      for (const block of turn.content as ContentBlock[]) {
        if (block.type === "tool_use") toolCallCount++;
      }
    }
  }

  return toolCallCount > 0 ? `${toolCallCount} operations` : "Task completed";
}
register(agentTool);
