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
import { SessionManager } from "../services/session-manager.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { switchSession } from "../services/session-lifecycle.js";
import { ShellService } from "../services/shell-service.js";
import { ToolExecutor } from "../tools/executor.js";
import { getAll } from "../tools/index.js";
import { createLogger } from "../utils/logger.js";
import { loadGlobalPrompt } from "../utils/prompts.js";
import type { AppRuntime } from "./types.js";
import type { CommandContext } from "../ui/commands/index.js";

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
  );
  const shellService = new ShellService({ cwd });
  const promptManager = new PromptManager(userPrompt, projectPromptFile);
  promptManager.refreshEnvironment();

  const tools = getAll();
  const availability = { agentRegistry };
  for (const [name, tool] of tools) {
    if (tool.requires?.some((r) => !availability[r])) {
      tools.delete(name);
    }
  }
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService,
    context: sessionManager.getContext(),
    registry: agentRegistry,
    appConfig: config,
    currentAgentId: "1",
    services: { shell: shellService },
  });

  // deps is a shared mutable bag: modelSwitchService writes client/model,
  // session switches write logger, and runAgent reads the latest each loop.
  const deps: AgentDeps = {
    client: initialClient,
    model: initialModel,
    logger,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
  };

  const modelSwitchService = new ModelSwitchService({
    appConfig: config,
    contextManager,
    sessionManager,
    setModel: (client, model) => {
      deps.client = client;
      deps.model = model;
    },
    permissionService,
  });

  sessionManager.setSession(initialSession);

  const commandContext: CommandContext = {
    model: initialModel,
    config,
    context: sessionManager.getContext(),
    sessionManager,
    get changeJournal() {
      return sessionManager.getChangeJournal();
    },
    sessionStats,
    modelSwitchService,
    contextManager,
    isAgentRunning: () => false,
    loadContext: (blocks, totalTokens = 0) => {
      sessionManager.getContext().replaceBlocks(blocks);
      contextManager.setTokenCount(totalTokens);
    },
    switchSession: async (name: string, opts?: { statusMessage?: string }) => {
      await switchSession({
        sessionManager,
        sessionName: name,
        setLogger: (newLogger) => {
          deps.logger = newLogger;
        },
        setCurrentSession: () => {},
        sessionStats,
        statusMessage: opts?.statusMessage,
      });
    },
    renameCurrentSession: async (newName: string) => {
      const oldName = sessionManager.getSessionName();
      await SessionPersistence.rename(oldName, newName);
      const newLogger = await createLogger(
        SessionPersistence.getProjectHash(),
        newName,
      );
      sessionManager.setSession(newName);
      deps.logger = newLogger;
      sessionManager.reportStatus({
        role: "status",
        content: `Renamed: ${oldName} -> ${newName}`,
        timestamp: new Date(),
      });
    },
    presentInput: () => {},
    exit: () => process.exit(0),
  };

  return {
    deps,
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
