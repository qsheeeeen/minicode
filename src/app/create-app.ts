import path from "path";
import os from "os";
import type { Args } from "../args.js";
import type { AgentDeps } from "../agent.js";
import type { AppConfig } from "../config.js";
import { createClient } from "../llm/client.js";
import { Model } from "../llm/model.js";
import { SkillManager } from "../skills/skill-manager.js";
import {
  AgentRegistry,
  RuntimeEvents,
  SessionStats,
} from "../services/index.js";
import { ContextManager } from "../services/context-manager.js";
import { ModelSwitchService } from "../services/model-switcher.js";
import { PermissionService } from "../services/permission.js";
import { PromptManager } from "../services/prompt-manager.js";
import { RuntimeState } from "../services/runtime-state.js";
import { SessionManager } from "../services/session-manager.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { ShellService } from "../services/shell-service.js";
import { ToolExecutor } from "../tools/executor.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import { createCapabilities, type SubAgentSpawner } from "../tools/registry.js";
import {
  ShellCapability,
  RegistryCapability,
  ChangeJournalCapability,
  SubAgentSpawnerCapability,
} from "../tools/capabilities.js";
import { runSubAgent } from "../sub-agent.js";
import { createLogger } from "../utils/logger.js";
import { loadGlobalPrompt } from "../utils/prompts.js";
import { getAvailableSkills } from "../skills/index.js";
import { createCommandContext } from "../ui/commands/create-context.js";
import { registerAllCommands } from "../ui/commands/index.js";
import { createSubAgentRuntime } from "./create-sub-agent-runtime.js";
import type { AppRuntime } from "./types.js";

export interface CreateAppOpts {
  readonly args: Args;
  readonly config: AppConfig;
  readonly version: string;
  readonly cwd: string;
  readonly programStartTime: number;
  readonly stdinIsTTY: boolean;
}

export async function createApp(opts: CreateAppOpts): Promise<AppRuntime> {
  const { args, config, version, cwd, programStartTime, stdinIsTTY } = opts;
  const {
    model,
    permissionMode,
    compressionThreshold,
    thinking,
    initialPrompt,
    sessionName,
    resumeRecent,
  } = args;

  if (!model) {
    throw new Error(
      "No valid model configuration found. Please set model in config.json",
    );
  }

  const headless = args.headless ?? !stdinIsTTY;

  const globalPrompt = await loadGlobalPrompt();
  const promptFiles: string[] = [];
  if (globalPrompt) promptFiles.push("~/.minicode/AGENTS.md");

  const projectPromptPath = path.resolve(cwd, "AGENTS.md");
  let projectPromptFile = "";
  try {
    const fs = await import("fs/promises");
    await fs.access(projectPromptPath);
    projectPromptFile = "./AGENTS.md";
    promptFiles.push(projectPromptFile);
  } catch {
    // Project prompt file doesn't exist — skip
  }
  const userPrompt = globalPrompt || "";

  let initialSession: string;
  if (sessionName) {
    initialSession = sessionName;
  } else if (resumeRecent) {
    const recent = await SessionPersistence.getMostRecent();
    initialSession = recent || `session-${Date.now()}`;
  } else {
    initialSession = `session-${Date.now()}`;
  }

  const logger = await createLogger(
    SessionPersistence.getProjectHash(),
    initialSession,
  );

  const skillManager = new SkillManager()
    .addDirectory(path.join(os.homedir(), ".minicode", "skills"))
    .addDirectory(path.resolve(cwd, ".agents", "skills"));
  await skillManager.loadAll();
  skillManager.registerAsCommands();

  const agentRegistry = new AgentRegistry();
  const runtimeEvents = new RuntimeEvents();
  const sessionStats = new SessionStats();
  const initialClient = createClient(
    model.protocol,
    model.apiKey,
    model.baseURL,
  );
  const initialModel = new Model(
    model.model,
    model.provider,
    model.contextLength ?? 200000,
    thinking.effort,
    model.displayName,
  );

  const sessionManager = new SessionManager(
    undefined,
    sessionStats,
    runtimeEvents,
  );
  const contextManager = new ContextManager({
    client: initialClient,
    model: initialModel,
    getContext: () => sessionManager.getContext(),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    setActiveUserMessageOrdinal: (ordinal) =>
      sessionManager.setActiveUserMessageOrdinal(ordinal),
    events: runtimeEvents,
    compressionThresholdRatio: compressionThreshold,
    sessionStats: sessionManager.getSessionStats(),
  });
  const permissionService = new PermissionService(
    permissionMode,
    initialClient,
    initialModel,
    runtimeEvents,
  );
  const shellService = new ShellService({ cwd });
  const promptManager = new PromptManager(
    userPrompt,
    projectPromptFile,
    "",
    getAvailableSkills(),
  );
  promptManager.refreshEnvironment();

  const toolRegistry = createDefaultToolRegistry();
  const tools = toolRegistry.getAll();
  const availability = { agentRegistry };
  for (const [name, tool] of tools) {
    if (tool.requires?.some((r) => !availability[r])) {
      tools.delete(name);
    }
  }
  const spawnSubAgent: SubAgentSpawner = (params) =>
    runSubAgent({
      ...params,
      permissionService,
      toolRegistry,
      createRuntime: (opts) => createSubAgentRuntime(opts),
    });
  const capabilities = createCapabilities([
    [ShellCapability, shellService],
    [RegistryCapability, agentRegistry],
    [ChangeJournalCapability, sessionManager.getChangeJournal()],
    [SubAgentSpawnerCapability, spawnSubAgent],
  ]);
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService,
    context: sessionManager.getContext(),
    appConfig: config,
    currentAgentId: "1",
    capabilities,
  });

  // RuntimeState is the sole owner of mutable handles; deps exposes read-only
  // getters so swap-heavy services never write into the agent's dependency bag.
  const runtimeState = new RuntimeState(initialClient, initialModel, logger);
  const deps: AgentDeps = {
    get client() {
      return runtimeState.client;
    },
    get model() {
      return runtimeState.model;
    },
    get logger() {
      return runtimeState.logger;
    },
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };

  const modelSwitchService = new ModelSwitchService({
    appConfig: config,
    contextManager,
    sessionManager,
    runtimeState,
    permissionService,
  });

  sessionManager.setSession(initialSession);

  const commandContext = createCommandContext({
    deps,
    config,
    sessionStats,
    modelSwitchService,
    contextManager,
    runtimeState,
    bridges: {
      isAgentRunning: () => false,
      presentInput: () => {},
      exit: () => process.exit(0),
    },
  });

  registerAllCommands();

  return {
    deps,
    runtimeState,
    config,
    version,
    promptFiles,
    initialSession,
    initialPrompt,
    sessionName,
    resumeRecent,
    headless,
    programStartTime,
    agentRegistry,
    sessionStats,
    runtimeEvents,
    sessionManager,
    contextManager,
    permissionService,
    modelSwitchService,
    shellService,
    commandContext,
  };
}
