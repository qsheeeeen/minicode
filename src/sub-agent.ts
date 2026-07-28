// Sub-agent: declarative spawn of a typed child agent. Wiring (createSubAgent
// Runtime) + orchestration (runSubAgent) both live here in the agent layer — a
// child runtime is assembled dynamically at spawn time, not at app startup, so
// its composition belongs with the spawn logic, not in the app composition root.

import { runAgent, type AgentDeps } from "./agent.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { RuntimeEvents } from "./services/runtime-events.js";
import { PromptManager } from "./services/prompt-manager.js";
import { PermissionService } from "./services/permission.js";
import { ToolExecutor } from "./tools/executor.js";
import {
  getSubAgentTools,
  createCapabilities,
  type ToolDef,
  type ToolRunResult,
  type ToolExecutionContext,
  type Capabilities,
} from "./tools/registry.js";
import { getAgentType, DEFAULT_AGENT_TYPE } from "./tools/agent-types.js";
import {
  ShellCapability,
  RegistryCapability,
  ChangeJournalCapability,
  SubAgentSpawnerCapability,
} from "./tools/capabilities.js";
import { ModelFactory, type Model } from "./llm/model.js";
import type { LLMClient } from "./llm/client.js";
import type { LLMBlock } from "./llm/context.js";
import type { AppConfig } from "./config.js";

// ── Runtime wiring ────────────────────────────────────────────────────────

export interface SubAgentRuntimeOpts {
  client: LLMClient;
  model: Model;
  userPrompt: string;
  roleSystemPrompt?: string;
  tools: Map<string, ToolDef<any>>;
  permissionService: PermissionService;
  subId: string;
  appConfig?: AppConfig;
  /** Parent capabilities — shell/registry/spawnSubAgent reused, changeJournal overridden. */
  parentCapabilities: Capabilities;
  compressionThresholdRatio?: number;
}

export interface SubAgentRuntime {
  deps: AgentDeps;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  runtimeEvents: RuntimeEvents;
}

/** Wire a standalone child runtime (parameterised mirror of create-app's wiring). */
export function createSubAgentRuntime(
  opts: SubAgentRuntimeOpts,
): SubAgentRuntime {
  const {
    client,
    model,
    userPrompt,
    roleSystemPrompt,
    tools,
    permissionService,
    subId,
    appConfig,
    parentCapabilities,
    compressionThresholdRatio = 0.8,
  } = opts;

  const sessionManager = new SessionManager();
  const runtimeEvents = new RuntimeEvents();
  const contextManager = new ContextManager({
    client,
    model,
    getContext: () => sessionManager.getContext(),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    setActiveUserMessageOrdinal: (ordinal) =>
      sessionManager.setActiveUserMessageOrdinal(ordinal),
    events: runtimeEvents,
    compressionThresholdRatio,
  });
  const promptManager = new PromptManager(userPrompt, "", roleSystemPrompt ?? "");
  // Child capabilities: reuse the parent's stable services, override changeJournal.
  const capabilities = createCapabilities([
    [ShellCapability, parentCapabilities.get(ShellCapability)],
    [RegistryCapability, parentCapabilities.get(RegistryCapability)],
    [ChangeJournalCapability, sessionManager.getChangeJournal()],
    [
      SubAgentSpawnerCapability,
      parentCapabilities.get(SubAgentSpawnerCapability),
    ],
  ]);
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService,
    context: sessionManager.getContext(),
    appConfig,
    currentAgentId: subId,
    capabilities,
  });
  const deps: AgentDeps = {
    client,
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };
  return { deps, sessionManager, contextManager, runtimeEvents };
}

// ── Spawn ─────────────────────────────────────────────────────────────────

export interface RunSubAgentParams {
  task: string;
  agentType?: string;
  parent: ToolExecutionContext;
  /** Reuses the parent's PermissionService so the child inherits its mode. */
  permissionService: PermissionService;
}

/** Resolve the type, build + run the child, return its summary. Registry
 *  progress/cleanup handled here; errors returned, not thrown. */
export async function runSubAgent(
  params: RunSubAgentParams,
): Promise<ToolRunResult> {
  const { task, parent, permissionService } = params;
  const agentTypeName = params.agentType || DEFAULT_AGENT_TYPE;

  const type = getAgentType(agentTypeName);
  if (!type) {
    return { outcome: "error", reason: `Unknown agent type: ${agentTypeName}` };
  }

  const registry = parent.capabilities.get(RegistryCapability);
  if (!registry) {
    return { outcome: "error", reason: "AgentRegistry not available" };
  }

  const config = parent.config;

  // Resolve tool-set from the type declaration.
  const tools = Array.isArray(type.tools)
    ? getSubAgentTools({ allowlist: type.tools })
    : getSubAgentTools({ readOnly: type.tools === "readonly" });

  // Resolve model — optionally override via the type's tier.
  const appConfig = parent.appConfig;
  let subClient: LLMClient = config.client;
  let subModel: Model = config.model;
  if (type.tier && appConfig) {
    const spec = appConfig.tiers?.[type.tier];
    if (spec) {
      const selection = new ModelFactory(appConfig).fromSpec(spec);
      if (selection) {
        subClient = selection.client;
        subModel = selection.model;
      }
    }
  }

  const subId = registry.allocateSubId();
  const parentId = parent.currentAgentId || "1";

  const { deps, sessionManager, contextManager, runtimeEvents } =
    createSubAgentRuntime({
      client: subClient,
      model: subModel,
      userPrompt: config.userPrompt,
      roleSystemPrompt: type.systemPrompt,
      tools,
      permissionService,
      subId,
      appConfig,
      parentCapabilities: parent.capabilities,
    });
  const subContext = sessionManager.getContext();

  const unsubTokens = runtimeEvents.subscribe((event) => {
    if (event.type === "context.tokens_changed") {
      registry.updateProgress(subId, { tokenCount: event.tokenCount });
    }
  });
  let toolCallCount = 0;
  const unsubBlocks = subContext.onChange(() => {
    const tc = subContext.getBlocks().filter((b) => b.type === "tool_use").length;
    if (tc !== toolCallCount) {
      toolCallCount = tc;
      registry.updateProgress(subId, { toolCalls: tc });
    }
  });

  const subController = new AbortController();
  const onParentAbort = () => subController.abort();
  parent.signal?.addEventListener("abort", onParentAbort);

  registry.register({
    id: subId,
    type: "sub",
    context: subContext,
    status: "running",
    task,
    parentId,
  });

  try {
    await runAgent(deps, task, subController.signal);
    const blocks = subContext.getBlocks();
    const finalResponse = extractFinalResponse(blocks);
    const summary = generateSummary(blocks);
    registry.updateProgress(subId, {
      tokenCount: contextManager.getTokenCount(),
      toolCalls: toolCallCount,
    });
    registry.updateStatus(subId, "completed");
    registry.updateSummary(subId, summary);
    registry.remove(subId);
    return {
      outcome: "success",
      result: finalResponse || `Agent #${subId} completed: ${summary}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    registry.updateStatus(subId, "error");
    registry.updateSummary(subId, `Error: ${msg}`);
    registry.remove(subId);
    return { outcome: "success", result: `Agent #${subId} failed: ${msg}` };
  } finally {
    unsubTokens();
    unsubBlocks();
    parent.signal?.removeEventListener("abort", onParentAbort);
  }
}

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
  const toolCallCount = blocks.filter((b) => b.type === "tool_use").length;
  return toolCallCount > 0 ? `${toolCallCount} operations` : "Task completed";
}
