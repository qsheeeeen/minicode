// Sub-agent: declarative spawn of a typed child agent. This file is pure
// policy (resolve type → build runtime via injected factory → orchestrate).
// The runtime factory (app/create-agent-runtime.ts) is shared with the main
// agent — a sub-agent is the same agent loop, parameterized by tools, role
// prompt, and lifecycle.

import { runAgent, type AgentRuntimeOpts, type AgentRuntime } from "./agent.js";
import { PermissionService } from "./services/permission.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
import type { RuntimeEvents } from "./services/runtime-events.js";
import type { SessionStats } from "./services/session-stats.js";
import {
  type ToolDef,
  type ToolRunResult,
  type ToolExecutionContext,
  type Capabilities,
  type ToolRegistry,
  createCapabilities,
} from "./tools/registry.js";
import {
  type AgentTypeRegistry,
  DEFAULT_AGENT_TYPE,
} from "./tools/agent-types.js";
import {
  RegistryCapability,
  ShellCapability,
  ChangeJournalCapability,
  SubAgentSpawnerCapability,
  SkillRegistryCapability,
} from "./tools/capabilities.js";
import { ModelFactory } from "./llm/model.js";
import type { Model } from "./llm/model.js";
import type { LLMClient } from "./llm/client.js";
import type { LLMBlock } from "./core/context.js";
import type { AppConfig } from "./config.js";
import type pino from "pino";

// ── Spawn ─────────────────────────────────────────────────────────────────

export interface RunSubAgentParams {
  task: string;
  agentType?: string;
  parent: ToolExecutionContext;
  /** Reuses the parent's PermissionService so the child inherits its mode. */
  permissionService: PermissionService;
  /** Tool registry owned by the composition root. */
  toolRegistry: ToolRegistry;
  /** Agent-type registry owned by the composition root. */
  agentTypes: AgentTypeRegistry;
  /** Runtime factory injected from the composition root (app/). */
  createRuntime: (opts: AgentRuntimeOpts) => AgentRuntime;
}

/** Resolve the type, build + run the child, return its summary. Registry
 *  progress/cleanup handled here; errors returned, not thrown. */
export async function runSubAgent(
  params: RunSubAgentParams,
): Promise<ToolRunResult> {
  const {
    task,
    parent,
    permissionService,
    toolRegistry,
    agentTypes,
    createRuntime,
  } = params;
  const agentTypeName = params.agentType || DEFAULT_AGENT_TYPE;

  const type = agentTypes.get(agentTypeName);
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
    ? toolRegistry.getSubAgentTools({ allowlist: type.tools })
    : toolRegistry.getSubAgentTools({ readOnly: type.tools === "readonly" });

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

  const { deps, sessionManager, contextManager, runtimeEvents } = createRuntime(
    {
      client: subClient,
      model: subModel,
      userPrompt: config.userPrompt,
      roleSystemPrompt: type.systemPrompt,
      tools,
      permissionService,
      currentAgentId: subId,
      appConfig,
      // Child inherits the parent's stable services; only changeJournal is
      // bound to the child's own fresh session.
      capabilities: ({ sessionManager: childSession }) =>
        createCapabilities([
          [ShellCapability, parent.capabilities.get(ShellCapability)],
          [RegistryCapability, parent.capabilities.get(RegistryCapability)],
          [ChangeJournalCapability, childSession.getChangeJournal()],
          [
            SubAgentSpawnerCapability,
            parent.capabilities.get(SubAgentSpawnerCapability),
          ],
          [
            SkillRegistryCapability,
            parent.capabilities.get(SkillRegistryCapability),
          ],
        ]),
      skills:
        parent.capabilities.get(SkillRegistryCapability)?.getAvailable() ?? [],
      persistent: false,
    },
  );
  const subContext = sessionManager.getContext();

  const unsubTokens = runtimeEvents.subscribe((event) => {
    if (event.type === "context.tokens_changed") {
      registry.updateProgress(subId, { tokenCount: event.tokenCount });
    }
  });
  let toolCallCount = 0;
  const unsubBlocks = subContext.onChange(() => {
    const tc = subContext
      .getBlocks()
      .filter((b) => b.type === "tool_use").length;
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
    // Inherit the parent's prompter so permission prompts inside the child
    // (e.g. Shell in manual mode) reach the user instead of being silently
    // denied — without it the run breaks early and no final summary exists.
    await runAgent(deps, task, subController.signal, {
      prompter: parent.prompter,
    });
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
    return { outcome: "error", reason: `Agent #${subId} failed: ${msg}` };
  } finally {
    unsubTokens();
    unsubBlocks();
    parent.signal?.removeEventListener("abort", onParentAbort);
  }
}

function extractFinalResponse(blocks: LLMBlock[]): string | null {
  // Only text emitted after the last tool round counts as the final
  // response; otherwise a stale intro text can masquerade as the result
  // when the model ends its turn with an empty/thinking-only message.
  let afterLastTool = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "tool_use" || blocks[i].type === "tool_result") {
      afterLastTool = i + 1;
      break;
    }
  }
  for (let i = blocks.length - 1; i >= afterLastTool; i--) {
    const block = blocks[i];
    if (block.type === "text" && block.text.trim()) {
      return block.text.trim();
    }
  }
  return null;
}

function generateSummary(blocks: LLMBlock[]): string {
  const toolCallCount = blocks.filter((b) => b.type === "tool_use").length;
  if (toolCallCount === 0) return "Task completed";
  // The agent ended without a text summary (thinking-only final message).
  // Surface the most recent tool outputs so the caller still gets the actual
  // content instead of a bare operation count.
  const results = blocks
    .filter(
      (b): b is Extract<LLMBlock, { type: "tool_result" }> =>
        b.type === "tool_result",
    )
    .slice(-2)
    .map((b) => b.content.trim())
    .filter(Boolean)
    .map((content) =>
      content.length > 1000
        ? `${content.slice(0, 1000)}... (truncated)`
        : content,
    );
  const output =
    results.length > 0 ? `\nLatest output:\n${results.join("\n---\n")}` : "";
  return `${toolCallCount} operations${output}`;
}
