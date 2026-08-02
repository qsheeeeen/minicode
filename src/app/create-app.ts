import path from "path";
import os from "os";
import type { Args } from "../args.js";
import type { AgentDeps } from "../agent.js";
import type { AppConfig } from "../config.js";
import { createClient } from "../llm/client.js";
import { Model } from "../llm/model.js";
import { SkillManager } from "../skills/skill-manager.js";
import { createDefaultSkillRegistry } from "../skills/index.js";
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
  SkillRegistryCapability,
} from "../tools/capabilities.js";
import { createDefaultAgentTypes } from "../tools/agent-types.js";
import { runSubAgent } from "../sub-agent.js";
import { createLogger } from "../utils/logger.js";
import { loadGlobalPrompt } from "../utils/prompts.js";
import {
  CommandRegistry,
  createCommandContext,
  registerBuiltinCommands,
  registerSkillCommands,
} from "../ui/commands/index.js";
import { createDefaultRouter } from "../ui/routing.js";
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

  const skillRegistry = createDefaultSkillRegistry();
  const skillManager = new SkillManager(skillRegistry)
    .addDirectory(path.join(os.homedir(), ".minicode", "skills"))
    .addDirectory(path.resolve(cwd, ".agents", "skills"));
  await skillManager.loadAll();

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

  // RuntimeState is the single owner of the mutable client/model/logger
  // handles; downstream services follow model.changed instead of being
  // manually synced by each mutator.
  const runtimeState = new RuntimeState(
    initialClient,
    initialModel,
    logger,
    runtimeEvents,
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

  // One sync point for model switches: runtimeState emits, consumers follow.
  runtimeEvents.subscribe((event) => {
    if (event.type === "model.changed") {
      contextManager.setModel(event.client, event.model);
      permissionService.updateAutoGate(event.client, event.model);
    }
  });

  const shellService = new ShellService({ cwd });
  const promptManager = new PromptManager(
    userPrompt,
    projectPromptFile,
    "",
    skillRegistry.getAvailable(),
  );
  promptManager.refreshEnvironment();

  const agentTypes = createDefaultAgentTypes();
  const toolRegistry = createDefaultToolRegistry({ agentTypes });
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
      agentTypes,
      createRuntime: (opts) => createSubAgentRuntime(opts),
    });
  const capabilities = createCapabilities([
    [ShellCapability, shellService],
    [RegistryCapability, agentRegistry],
    [ChangeJournalCapability, sessionManager.getChangeJournal()],
    [SubAgentSpawnerCapability, spawnSubAgent],
    [SkillRegistryCapability, skillRegistry],
  ]);
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService,
    context: sessionManager.getContext(),
    appConfig: config,
    currentAgentId: "1",
    capabilities,
  });

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

  const commandRegistry = new CommandRegistry();
  registerBuiltinCommands(commandRegistry);
  registerSkillCommands(commandRegistry, skillRegistry);
  const router = createDefaultRouter();

  const modelSwitchService = new ModelSwitchService({
    appConfig: config,
    contextManager,
    sessionManager,
    runtimeState,
  });

  sessionManager.setSession(initialSession);

  const commandContext = createCommandContext({
    deps,
    config,
    commands: commandRegistry,
    skills: skillRegistry,
    router,
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
    commandRegistry,
    skillRegistry,
    router,
  };
}
