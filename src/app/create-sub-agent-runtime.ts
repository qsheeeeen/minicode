// Composition root for sub-agent runtimes. The only place that knows concrete
// service implementations for a child agent; sub-agent.ts (policy) receives
// this factory by injection so the agent layer never depends on app/.

import { SessionManager } from "../services/session-manager.js";
import { ContextManager } from "../services/context-manager.js";
import { RuntimeEvents } from "../services/runtime-events.js";
import { PromptManager } from "../services/prompt-manager.js";
import { ToolExecutor } from "../tools/executor.js";
import { createCapabilities } from "../tools/registry.js";
import {
  ShellCapability,
  RegistryCapability,
  ChangeJournalCapability,
  SubAgentSpawnerCapability,
} from "../tools/capabilities.js";
import { getAvailableSkills } from "../skills/index.js";
import type { SubAgentRuntime, SubAgentRuntimeOpts } from "../sub-agent.js";

/** Wire a standalone child runtime (parameterised mirror of create-app). */
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
  const promptManager = new PromptManager(
    userPrompt,
    "",
    roleSystemPrompt ?? "",
    getAvailableSkills(),
  );
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
  const deps = {
    client,
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };
  return { deps, sessionManager, contextManager, runtimeEvents };
}
