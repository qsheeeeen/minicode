import path from "path";
import os from "os";
import type { Args } from "../args.js";
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
import { ModelSwitchService } from "../services/model-switcher.js";
import { PermissionService } from "../services/permission.js";
import { RuntimeState } from "../services/runtime-state.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { ShellService } from "../services/shell-service.js";
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
import { createAgentRuntime } from "./create-agent-runtime.js";
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

  const permissionService = new PermissionService(
    permissionMode,
    initialClient,
    initialModel,
    runtimeEvents,
  );

  const shellService = new ShellService({ cwd });

  const agentTypes = createDefaultAgentTypes();
  const toolRegistry = createDefaultToolRegistry({ agentTypes });
  const tools = toolRegistry.getAll();
  const availability = { agentRegistry };
  for (const [name, tool] of tools) {
    if (tool.requires?.some((r) => !availability[r])) {
      tools.delete(name);
    }
    // Interactive tools (e.g. AskUser) are meaningless without a human at the
    // terminal; don't let the model call them in headless/scripted runs.
    if (headless && tool.interactive) {
      tools.delete(name);
    }
  }
  const spawnSubAgent: SubAgentSpawner = (params) =>
    runSubAgent({
      ...params,
      permissionService,
      toolRegistry,
      agentTypes,
      createRuntime: (opts) => createAgentRuntime(opts),
    });

  const runtime = createAgentRuntime({
    client: initialClient,
    model: initialModel,
    userPrompt,
    projectPromptFile,
    skills: skillRegistry.getAvailable(),
    tools,
    permissionService,
    appConfig: config,
    currentAgentId: "1",
    capabilities: ({ sessionManager }) =>
      createCapabilities([
        [ShellCapability, shellService],
        [RegistryCapability, agentRegistry],
        [ChangeJournalCapability, sessionManager.getChangeJournal()],
        [SubAgentSpawnerCapability, spawnSubAgent],
        [SkillRegistryCapability, skillRegistry],
      ]),
    compressionThresholdRatio: compressionThreshold,
    sessionStats,
    events: runtimeEvents,
    getClient: () => runtimeState.client,
    getModel: () => runtimeState.model,
    getLogger: () => runtimeState.logger,
  });
  const { deps, sessionManager, contextManager } = runtime;
  void deps.promptManager.refreshEnvironment();

  // One sync point for model switches: runtimeState emits, consumers follow.
  runtimeEvents.subscribe((event) => {
    if (event.type === "model.changed") {
      contextManager.setModel(event.client, event.model);
      permissionService.updateAutoGate(event.client, event.model);
    }
  });

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
