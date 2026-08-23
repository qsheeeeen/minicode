import type { AgentDeps } from "../../agent.js";
import type { AppConfig } from "../../config.js";
import type { ContextManager } from "../../services/context-manager.js";
import type { ClipboardService } from "../../services/clipboard.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { RuntimeState } from "../../services/runtime-state.js";
import type { SessionStats } from "../../services/session-stats.js";
import {
  renameSession,
  resumeSession,
  switchSession,
} from "../../services/session-lifecycle.js";
import type { SkillRegistry } from "../../skills/index.js";
import type { InputRouter } from "../routing.js";
import type { CommandContext, InputRequest } from "./index.js";
import type { CommandRegistry } from "./registry.js";

/**
 * UI-facing bridges. The composition root (headless) and the TUI inject
 * different implementations; everything else in CommandContext is shared.
 */
export interface CommandContextBridges {
  isAgentRunning: () => boolean;
  presentInput: (request: InputRequest) => void;
  exit: () => void;
}

export interface CreateCommandContextOpts {
  deps: AgentDeps;
  config: AppConfig;
  commands: CommandRegistry;
  skills: SkillRegistry;
  router: InputRouter;
  sessionStats: SessionStats;
  modelSwitchService: ModelSwitchService;
  contextManager: ContextManager;
  runtimeState: RuntimeState;
  clipboard: ClipboardService;
  bridges: CommandContextBridges;
}

/** Single construction site for CommandContext (used by app + TUI). */
export function createCommandContext(
  opts: CreateCommandContextOpts,
): CommandContext {
  const {
    deps,
    config,
    commands,
    skills,
    router,
    sessionStats,
    modelSwitchService,
    contextManager,
    runtimeState,
    clipboard,
    bridges,
  } = opts;
  const { sessionManager } = deps;
  const context = sessionManager.getContext();

  return {
    model: deps.model,
    config,
    context,
    commands,
    skills,
    router,
    sessionManager,
    clipboard,
    get changeJournal() {
      return sessionManager.getChangeJournal();
    },
    sessionStats,
    modelSwitchService,
    contextManager,
    isAgentRunning: bridges.isAgentRunning,
    resumeSession: (name) =>
      resumeSession({
        sessionManager,
        contextManager,
        runtimeState,
        sessionStats,
        name,
      }),
    switchSession: async (name, opts2) => {
      await switchSession({
        sessionManager,
        sessionName: name,
        runtimeState,
        sessionStats,
        statusMessage: opts2?.statusMessage,
      });
    },
    renameCurrentSession: async (newName: string) => {
      await renameSession({
        sessionManager,
        runtimeState,
        oldName: sessionManager.getSessionName(),
        newName,
      });
    },
    presentInput: bridges.presentInput,
    exit: bridges.exit,
  };
}
