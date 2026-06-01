#!/usr/bin/env node
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { render } from "ink";
import { loadAllConfig } from "./config.js";
import { Agent } from "./agent.js";
import { AgentRegistry } from "./services/index.js";
import { MessageStore } from "./messages.js";
import { createLogger } from "./utils/logger.js";
import { parseArgs, type PermissionMode } from "./args.js";
import { loadGlobalPrompt } from "./utils/prompts.js";
import { loadSkills, getAvailableSkills as getSkills, getSkillBody } from "./skills/index.js";
import { App } from "#src/ui/tui.js";
import { getCommandNames, registerCommand, executeCommand } from "#src/ui/commands/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, "../package.json");
const packageJson = JSON.parse(
  await import("fs/promises").then((fs) => fs.readFile(packagePath, "utf-8")),
);
const VERSION = packageJson.version;

// Parse CLI arguments (handle early-exit flags before config loading)
const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`Mini Code v${VERSION}`);
  process.exit(0);
}
let {
  modelOverride,
  initialPrompt,
  sessionName,
  resumeRecent,
  headless,
  permissionMode: cliPermissionMode,
} = parseArgs(process.argv);

// Support for piped input
if (!process.stdin.isTTY) {
  try {
    const pipedInput = fs.readFileSync(0, "utf-8").trim();
    if (pipedInput) {
      initialPrompt = initialPrompt
        ? `${initialPrompt}\n\n${pipedInput}`
        : pipedInput;
      // Default to headless mode when piped, as TUI requires a TTY
      if (headless === undefined) {
        headless = true;
      }
    }
  } catch (err) {
    // Handle or ignore potential read errors from empty pipes
  }
}

// Ensure headless is boolean for downstream
headless = !!headless;

// Get configuration
const config = await loadAllConfig(modelOverride ?? process.env.MODEL);

if (!config.model) {
  console.error(
    "Error: No valid model configuration found. Please set model in config.json",
  );
  process.exit(1);
}

// Resolve permission mode: CLI flag > config > default
const permissionMode: PermissionMode =
  cliPermissionMode || config.permissionMode || "manual";

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
  const recent = await MessageStore.getMostRecent();
  initialSession = recent || `session-${Date.now()}`;
} else {
  initialSession = `session-${Date.now()}`;
}

const logger = await createLogger(
  MessageStore.getProjectHash(),
  initialSession,
);

// Load global skills from ~/.minicode/skills/
await loadSkills(path.join(os.homedir(), ".minicode", "skills"));

// Load project skills from .agent/ directory
await loadSkills(path.resolve(process.cwd(), ".agent"));

// Register skills as slash commands (e.g. /skill-creator)
for (const skill of getSkills()) {
  if (getCommandNames().includes(skill.name)) {
    console.warn(
      `Skill "${skill.name}" skipped: a builtin command with the same name already exists.`,
    );
    continue;
  }
  const body = getSkillBody(skill.name);
  if (!body) continue;

  registerCommand({
    name: skill.name,
    description: skill.description,
    prompt: (args: string[]) => {
      const userInput = args.length > 0 ? `\n\n${args.join(" ")}` : "";
      return `<activated_skill name="${skill.name}">\n<instructions>\n${body}\n</instructions>\n</activated_skill>${userInput}`;
    },
  });
}

// Create shared AgentRegistry (used by both Agent tools and TUI state display)
const sharedAgentRegistry = new AgentRegistry();

// Create Agent (composition root — single creation point)
const agent = new Agent({
  apiKey: config.model!.apiKey,
  baseURL: config.model!.baseURL,
  model: config.model!.model,
  provider: config.model!.provider,
  contextLength: config.model!.contextLength,
  compressionThresholdRatio: config.compressionThreshold,
  thinkingEnabled: config.thinking.enabled,
  effort: config.thinking.effort,
  userPrompt,
  projectPromptFile,
  agentRegistry: sharedAgentRegistry,
});
agent.setSession(initialSession);
agent.setLogger(logger);
agent.setPermissionMode(permissionMode);

// Shared command context for headless mode
const cmdContext = {
  agent,
  setMessages: () => {},
  setCurrentSession: (name: string) => {
    initialSession = name;
    agent.currentSession = name;
  },
  setMode: () => {},
  setInputMode: () => {},
  setSessionList: () => {},
  setSelectedIndex: () => {},
  exit: () => process.exit(0),
};

// Branch: display layer only
if (headless) {
  if (!initialPrompt) {
    console.error("Error: --headless requires a prompt argument");
    process.exit(1);
  }

  const { runHeadless } = await import("#src/ui/headless.js");
  await runHeadless(agent, initialPrompt, sessionName, resumeRecent, cmdContext);
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
  />,
  { exitOnCtrlC: false },
);
