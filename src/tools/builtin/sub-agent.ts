import type { ToolDef, ToolResult, ToolExecutionContext } from "../registry.js";
import type { LLMBlock } from "../../llm/history.js";
import { Agent } from "../../agent.js";
import { SessionManager } from "../../services/session-manager.js";
import { ContextManager } from "../../services/context-manager.js";
import { PromptManager } from "../../services/prompt-manager.js";
import { ModelFactory } from "../../llm/model.js";
import { ToolExecutor } from "../executor.js";
import { PermissionService } from "../../services/permission.js";
import { getSubAgentTools } from "../registry.js";
import { Signal } from "../../utils/signal.js";
import { register } from "../registry.js";

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

    // Resolve model (optionally override via tier)
    const appConfig = context?.appConfig;
    let subClient = config.client;
    let subModel = config.model;
    if (tier && appConfig) {
      const modelSpec = appConfig.tiers?.[tier];
      if (modelSpec) {
        const factory = new ModelFactory(appConfig);
        const selection = factory.fromSpec(modelSpec);
        if (selection) {
          subClient = selection.client;
          subModel = selection.model;
        }
      }
    }

    const tokenCount$ = new Signal(0);
    const sessionManager = new SessionManager();
    const contextManager = new ContextManager({
      contextLength: subModel.getContextLength(),
      compressionThresholdRatio: 0.8,
      tokenCount$,
      contextManager: sessionManager.getHistory(),
      statusReporter: () => {}, // sub-agents don't report statuses
    });
    const promptManager = new PromptManager(config.userPrompt);
    const toolExecutor = new ToolExecutor({
      tools: getSubAgentTools(),
      permissionService: new PermissionService("manual"),
      getChangeJournal: () => sessionManager.getChangeJournal(),
      context: sessionManager.getHistory(),
    });
    const subAgent = new Agent({
      client: subClient,
      model: subModel,
      sessionManager,
      contextManager,
      toolExecutor,
      promptManager,
      tokenCount$,
      agentRegistry: registry,
      currentAgentId: subId,
      appConfig: appConfig!,
    });

    context?.signal?.addEventListener("abort", () => {
      subAgent.abort();
    });

    const subContext = sessionManager.getHistory();

    registry.register({
      id: subId,
      type: "sub",
      agent: subAgent,
      context: subContext,
      status: "running",
      task,
      parentId,
    });

    // Notify via parent agent's status reporter (if available through registry)
    const parentSession = registry.get(parentId);
    // Note: parent status notification is now handled by the registry update above
    // Sub-agent start/stop is tracked via registry.updateStatus()

    // Track progress during execution
    let toolCallCount = 0;
    subAgent.tokenCount$.subscribe((count: number) => {
      registry.updateProgress(subId, { tokenCount: count });
    });
    subContext.onChange(() => {
      const tc = subContext
        .getBlocks()
        .filter((block) => block.type === "tool_use").length;
      if (tc !== toolCallCount) {
        toolCallCount = tc;
        registry.updateProgress(subId, { toolCalls: tc });
      }
    });

    try {
      await subAgent.run(task);
      const blocks = subContext.getBlocks();
      const finalResponse = extractFinalResponse(blocks);
      const summary = generateSummary(blocks);
      registry.updateProgress(subId, {
        tokenCount: subAgent.tokenCount$.get(),
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

function extractFinalResponse(blocks: LLMBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "text" && block.text.trim()) {
      return block.text.trim();
    }
  }
  return null;
}

function generateSummary(blocks: LLMBlock[]): string {
  const toolCallCount = blocks.filter(
    (block) => block.type === "tool_use",
  ).length;
  return toolCallCount > 0 ? `${toolCallCount} operations` : "Task completed";
}
register(agentTool);
