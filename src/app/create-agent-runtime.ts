// The single agent-runtime assembly site. Both the main agent and every
// sub-agent are built by this function — "an agent" is one concept, and
// main vs sub differ only in parameters (tools, role prompt, lifecycle).

import type { AgentDeps } from "../agent.js";
import { SessionManager } from "../services/session-manager.js";
import { ContextManager } from "../services/context-manager.js";
import { PromptManager } from "../services/prompt-manager.js";
import { RuntimeEvents } from "../services/runtime-events.js";
import { ToolExecutor } from "../tools/executor.js";
import type { AgentRuntime, AgentRuntimeOpts } from "../sub-agent.js";

export function createAgentRuntime(opts: AgentRuntimeOpts): AgentRuntime {
  const events = opts.events ?? new RuntimeEvents();
  const sessionManager = new SessionManager(
    undefined,
    opts.sessionStats,
    events,
    opts.persistent ?? true,
  );
  const contextManager = new ContextManager({
    // Fixed for sub-agents, live for the main agent (RuntimeState getters).
    getClient: opts.getClient ?? (() => opts.client),
    getModel: opts.getModel ?? (() => opts.model),
    getContext: () => sessionManager.getContext(),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    setActiveUserMessageOrdinal: (ordinal) =>
      sessionManager.setActiveUserMessageOrdinal(ordinal),
    events,
    compressionThresholdRatio: opts.compressionThresholdRatio ?? 0.8,
    sessionStats: opts.sessionStats,
  });
  const promptManager = new PromptManager(
    opts.userPrompt,
    opts.projectPromptFile ?? "",
    opts.roleSystemPrompt ?? "",
    opts.skills ?? [],
  );
  const capabilities = opts.capabilities({ sessionManager });
  const toolExecutor = new ToolExecutor({
    tools: opts.tools,
    permissionService: opts.permissionService,
    context: sessionManager.getContext(),
    appConfig: opts.appConfig,
    currentAgentId: opts.currentAgentId,
    capabilities,
  });

  const deps: AgentDeps = {
    get client() {
      return opts.getClient ? opts.getClient() : opts.client;
    },
    get model() {
      return opts.getModel ? opts.getModel() : opts.model;
    },
    get logger() {
      return opts.getLogger ? opts.getLogger() : undefined;
    },
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };

  return { deps, sessionManager, contextManager, runtimeEvents: events };
}
