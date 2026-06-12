#!/usr/bin/env node
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { render } from "ink";
import { loadAllConfig } from "./config.js";
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
import { parseArgs } from "./args.js";
import { loadGlobalPrompt } from "./utils/prompts.js";
import { SkillManager } from "./skills/skill-manager.js";
import { App } from "./ui/tui.js";
import { Model } from "./llm/model.js";
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

// Parse CLI arguments (yargs handles --help/--version before config loading)
let {
  modelOverride,
  initialPrompt,
  sessionName,
  resumeRecent,
  headless,
  permissionMode: cliPermissionMode,
} = parseArgs(process.argv, VERSION);

// Auto-headless when stdin is not a TTY (piped input or no terminal).
// Piped content is read inside runHeadless; here we only decide the branch.
if (headless === undefined) {
  headless = !process.stdin.isTTY;
}
headless = !!headless;

// Get configuration
const config = await loadAllConfig(modelOverride, cliPermissionMode);

if (!config.model) {
  console.error(
    "Error: No valid model configuration found. Please set model in config.json",
  );
  process.exit(1);
}

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
  createClient(config.model!.protocol, config.model!.apiKey, config.model!.baseURL),
  config.model!.model,
  config.model!.provider,
  config.model!.contextLength ?? 200000,
  config.thinking.effort,
  config.model!.displayName,
);

const tokenCount$ = new Signal(0);
const sessionManager = new SessionManager(undefined, sharedSessionStats);
const contextManager = new ContextManager({
  contextLength: initialModel.getContextLength(),
  compressionThresholdRatio: config.compressionThreshold,
  tokenCount$,
  contextManager: sessionManager.getContext(),
  statusReporter: sessionManager.getStatusReporter(),
  sessionStats: sessionManager.getSessionStats(),
});
const promptManager = new PromptManager(userPrompt, projectPromptFile);
promptManager.refreshEnvironment(); // async, non-blocking

const permissionService = new PermissionService(config.permissionMode);
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
});
sessionManager.setSession(initialSession);
agent.logger = logger;

// Shared command context for headless mode
const cmdContext = {
  agent,
  model: initialModel,
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
