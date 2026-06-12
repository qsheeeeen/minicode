#!/usr/bin/env node
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { render } from "ink";
import { AppConfig } from "./config.js";
import { Agent } from "./agent.js";
import { AgentRegistry, SessionStats } from "./services/index.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { PromptManager } from "./services/prompt-manager.js";
import { ToolExecutor } from "./tools/executor.js";
import { PermissionService } from "./services/permission.js";
import { getAll } from "./tools/index.js";
import { Signal } from "./utils/signal.js";
import { SessionPersistence } from "./services/session-persistence.js";
import { createLogger } from "./utils/logger.js";
import { Args } from "./args.js";
import { loadGlobalPrompt } from "./utils/prompts.js";
import { SkillManager } from "./skills/skill-manager.js";
import { App } from "./ui/tui.js";
import { Model, ModelFactory } from "./llm/model.js";
import { createClient } from "./llm/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const programStartTime = Date.now();

// Read version from package.json
const packagePath = path.join(__dirname, "../package.json");
const packageJson = JSON.parse(
  await import("fs/promises").then((fs) => fs.readFile(packagePath, "utf-8")),
);
const VERSION = packageJson.version;

// 1. Config init — single instance, threaded everywhere via DI
const config = await AppConfig.load();

// 2. Parse args overlaid onto config — yargs handles --help/--version,
//    then args (model/permission) override config.
const args = new Args(process.argv, config, VERSION);
const { model, permissionMode, compressionThreshold, thinking, initialPrompt, sessionName, resumeRecent } = args;

// Auto-headless when stdin is not a TTY (piped input or no terminal).
// Piped content is read inside runHeadless; here we only decide the branch.
const headless = args.headless ?? !process.stdin.isTTY;

if (!model) {
  console.error(
    "Error: No valid model configuration found. Please set model in config.json",
  );
  process.exit(1);
}

const modelFactory = new ModelFactory(config);

// Load global prompt only (project prompt is loaded on-demand by the LLM)
const globalPrompt = await loadGlobalPrompt();
const promptFiles: string[] = [];
if (globalPrompt) promptFiles.push("~/.minicode/AGENTS.md");

const projectPromptPath = path.resolve(process.cwd(), "AGENTS.md");
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

// Determine initial session
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

// Load + wire skills (directories → global registry → slash commands)
const skillManager = new SkillManager()
  .addDirectory(path.join(os.homedir(), ".minicode", "skills"))
  .addDirectory(path.resolve(process.cwd(), ".agent"));
await skillManager.loadAll();
skillManager.registerAsCommands();

// Create shared AgentRegistry (used by both Agent tools and TUI state display)
const sharedAgentRegistry = new AgentRegistry();
const sharedSessionStats = new SessionStats();

// Create Agent (composition root — build managers, then inject)
const initialModel = new Model(
  createClient(model.protocol, model.apiKey, model.baseURL),
  model.model,
  model.provider,
  model.contextLength ?? 200000,
  thinking.effort,
  model.displayName,
);

const tokenCount$ = new Signal(0);
const sessionManager = new SessionManager(undefined, sharedSessionStats);
const contextManager = new ContextManager({
  contextLength: initialModel.getContextLength(),
  compressionThresholdRatio: compressionThreshold,
  tokenCount$,
  contextManager: sessionManager.getContext(),
  statusReporter: sessionManager.getStatusReporter(),
  sessionStats: sessionManager.getSessionStats(),
});
const promptManager = new PromptManager(userPrompt, projectPromptFile);
promptManager.refreshEnvironment(); // async, non-blocking

const permissionService = new PermissionService(permissionMode);
const tools = getAll();
const availability = { agentRegistry: sharedAgentRegistry };
for (const [name, tool] of tools) {
  if (tool.requires?.some((r) => !availability[r])) {
    tools.delete(name);
  }
}
const toolExecutor = new ToolExecutor({
  tools,
  permissionService,
  changeJournal: sessionManager.getChangeJournal(),
  context: sessionManager.getContext(),
});

const agent = new Agent({
  model: initialModel,
  sessionManager,
  contextManager,
  toolExecutor,
  promptManager,
  tokenCount$,
  agentRegistry: sharedAgentRegistry,
  appConfig: config,
});
sessionManager.setSession(initialSession);
agent.logger = logger;

// Shared command context for headless mode
const cmdContext = {
  agent,
  model: initialModel,
  config,
  context: sessionManager.getContext(),
  sessionManager,
  changeJournal: sessionManager.getChangeJournal(),
  tokenCount$,
  sessionStats: sharedSessionStats,
  setMessages: () => {},
  setCurrentSession: (name: string) => {
    initialSession = name;
    sessionManager.setSession(name);
  },
  setMode: () => {},
  setInputMode: () => {},
  setSessionList: () => {},
  setSelectedIndex: () => {},
  exit: () => process.exit(0),
};

// Branch: display layer only
if (headless) {
  const { runHeadless } = await import("./ui/headless.js");
  await runHeadless(
    agent,
    initialPrompt,
    sessionManager,
    tokenCount$,
    sessionName,
    resumeRecent,
    cmdContext,
  );
  process.exit(0);
}

// Start TUI
render(
  <App
    agent={agent}
    config={config}
    version={VERSION}
    promptFiles={promptFiles}
    initialSession={initialSession}
    initialPrompt={initialPrompt}
    sessionName={sessionName}
    resumeRecent={resumeRecent}
    agentRegistry={sharedAgentRegistry}
    programStartTime={programStartTime}
    sessionStats={sharedSessionStats}
    sessionManager={sessionManager}
    context={sessionManager.getContext()}
    tokenCount$={tokenCount$}
    permissionService={permissionService}
  />,
  { exitOnCtrlC: false },
);
