import path from "path";
import type { Args } from "../args.js";
import type { AppConfig } from "../config.js";
import { registerBuiltinProtocols } from "../llm/protocols/index.js";
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
import { restoreSession } from "../services/session-lifecycle.js";
import { newSessionName } from "../services/session-manager.js";
import { RuntimeState } from "../services/runtime-state.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { ShellService } from "../services/shell-service.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import {
  createCapabilities,
  lazy,
  type SubAgentSpawner,
} from "../tools/registry.js";
import {
  ShellCapability,
  RegistryCapability,
  ChangeJournalCapability,
  SubAgentSpawnerCapability,
  SkillRegistryCapability,
} from "../tools/capabilities.js";
import { createDefaultAgentTypes } from "../tools/agent-types.js";
import { MAIN_AGENT_ID } from "../agent.js";
import { runSubAgent } from "../sub-agent.js";
import {
  formatEnvironmentContext,
  loadGlobalPrompt,
} from "../utils/prompts.js";
import { MINICODE_HOME } from "../utils/paths.js";
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

  // Composition, not import side effects: built-in protocols register here.
  registerBuiltinProtocols();

  // Independent startup reads run concurrently — they only feed wiring below.
  const [globalPrompt, hasProjectPrompt, recentSession] = await Promise.all([
    loadGlobalPrompt(),
    import("fs/promises").then((fs) =>
      fs.access(path.resolve(cwd, "AGENTS.md")).then(
        () => true,
        () => false,
      ),
    ),
    resumeRecent ? SessionPersistence.getMostRecent() : undefined,
  ]);

  const promptFiles: string[] = [];
  if (globalPrompt) promptFiles.push("~/.minicode/AGENTS.md");
  const projectPromptFile = hasProjectPrompt ? "./AGENTS.md" : "";
  if (hasProjectPrompt) promptFiles.push(projectPromptFile);

  const initialSession = sessionName ?? recentSession ?? newSessionName();

  // Prefetch the persisted session so the disk read overlaps skill loading
  // and the tool-availability probes instead of blocking first paint.
  const restoring = !!(sessionName || resumeRecent);
  const preload = restoring
    ? SessionPersistence.load(initialSession)
    : undefined;

  const skillRegistry = createDefaultSkillRegistry();
  const skillManager = new SkillManager(skillRegistry)
    .addDirectory(path.join(MINICODE_HOME, "skills"))
    .addDirectory(path.resolve(cwd, ".agents", "skills"));
  await Promise.all([skillManager.loadAll(), restoring && preload]);

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
  // handles; consumers resolve them through getters at use time.
  // The logger arrives with the session restore below (same name).
  const runtimeState = new RuntimeState(initialClient, initialModel);

  const permissionService = new PermissionService(
    permissionMode,
    () => runtimeState.client,
    () => runtimeState.model,
    runtimeEvents,
  );

  const shellService = new ShellService({ cwd });

  const agentTypes = createDefaultAgentTypes();
  const toolRegistry = createDefaultToolRegistry({ agentTypes });
  // Requirements carry their own probes; interactive tools drop out of
  // headless runs. The composition root states what it wants, not how.
  const tools = await toolRegistry.resolveTools(
    { shell: shellService },
    { headless },
  );
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
    userPrompt: globalPrompt,
    projectPromptFile,
    skills: skillRegistry.getAvailable(),
    tools,
    permissionService,
    appConfig: config,
    currentAgentId: MAIN_AGENT_ID,
    capabilities: ({ sessionManager }) =>
      createCapabilities([
        [ShellCapability, shellService],
        [RegistryCapability, agentRegistry],
        // The journal is recreated when a session is cleared — resolve it
        // at read time so tools never hold a closed handle.
        [
          ChangeJournalCapability,
          lazy(() => sessionManager.getChangeJournal()),
        ],
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
  // Environment snapshot for the system prompt, gathered through the shell
  // port (git is an uncontrolled side effect like any other command).
  // runProcess resolves spawn errors as values, so there is no reject path.
  void shellService
    .runProcess("git", ["status"], { timeoutMs: 5000 })
    .then((r) =>
      deps.promptManager.refreshEnvironment(
        formatEnvironmentContext(r.exitCode === 0 ? r.stdout : undefined),
      ),
    );

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

  // Bootstrap the initial session — the single restore site. Entry points
  // (TUI/headless) only wire rendering on top of the restored runtime.
  const restored = await restoreSession({
    sessionManager,
    contextManager,
    runtimeState,
    name: initialSession,
    load: restoring,
    preload,
  });
  if (sessionName && !restored.loaded) {
    sessionManager.reportStatus({
      role: "status",
      content: `Created new session: ${sessionName}`,
    });
  }

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
