#!/usr/bin/env node
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { render } from 'ink';
import { loadAllConfig } from './config.js';
import { Agent } from './agent.js';
import { AgentRegistry } from './services/index.js';
import { sessionManager } from './utils/session.js';
import { createLogger } from './utils/logger.js';
import { parseArgs, type PermissionMode } from './args.js';
import { loadGlobalPrompt, DEFAULT_PROMPT_FILE } from './utils/prompts.js';
import { skillRegistry } from './skills/index.js';
import { App } from './tui.js';
import { commandRegistry } from './commands/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(await import('fs/promises').then(fs => fs.readFile(packagePath, 'utf-8')));
const VERSION = packageJson.version;

// Parse CLI arguments (handle early-exit flags before config loading)
const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`Mini Code v${VERSION}`);
  process.exit(0);
}
const { modelOverride, initialPrompt, sessionName, resumeRecent, headless, permissionMode: cliPermissionMode } = parseArgs(process.argv);

// Get configuration
const config = await loadAllConfig(modelOverride ?? process.env.MODEL);

if (!config.model) {
  console.error('Error: No valid model configuration found. Please set model in config.json');
  process.exit(1);
}

// Resolve permission mode: CLI flag > config > default
const permissionMode: PermissionMode = cliPermissionMode || config.permissionMode || 'manual';

// Load global prompt only (project prompt is loaded on-demand by the LLM)
const globalPrompt = await loadGlobalPrompt();
const promptFiles: string[] = [];
if (globalPrompt) promptFiles.push(`~/.minicode/${DEFAULT_PROMPT_FILE}`);

const projectPromptPath = path.resolve(process.cwd(), config.promptFile);
let projectPromptFile = '';
try {
  const fs = await import('fs/promises');
  await fs.access(projectPromptPath);
  projectPromptFile = `./${config.promptFile}`;
  promptFiles.push(projectPromptFile);
} catch {
  // Project prompt file doesn't exist — skip
}
const userPrompt = globalPrompt || '';

// Determine initial session
let initialSession: string;
if (sessionName) {
  initialSession = sessionName;
} else if (resumeRecent) {
  const recent = await sessionManager.getMostRecent();
  initialSession = recent || `session-${Date.now()}`;
} else {
  initialSession = `session-${Date.now()}`;
}

const logger = await createLogger(sessionManager.getProjectHash(), initialSession);

// Load global skills from ~/.minicode/skills/
await skillRegistry.loadSkills(path.join(os.homedir(), '.minicode', 'skills'));

// Load project skills from configured directory (default: .minicode/skills)
const projectSkillsDir = config.skillsDir ?? '.minicode/skills';
await skillRegistry.loadSkills(path.resolve(process.cwd(), projectSkillsDir));

// Register skills as slash commands (e.g. /skill-creator)
for (const skill of skillRegistry.getAvailableSkills()) {
  if (commandRegistry.getCommandNames().includes(skill.name)) {
    console.warn(`Skill "${skill.name}" skipped: a builtin command with the same name already exists.`);
    continue;
  }
  const body = skillRegistry.getSkillBody(skill.name);
  if (!body) continue;

  commandRegistry.register({
    name: skill.name,
    description: skill.description,
    prompt: (args: string[]) => {
      const userInput = args.length > 0 ? `\n\n${args.join(' ')}` : '';
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

// Set shared command resolver so both headless and TUI use the same resolve path
agent.setCommandResolver((input: string) =>
  commandRegistry.parseAndExecute(input, {
    agent,
    setMessages: () => {},
    setCurrentSession: (name) => { initialSession = name; agent.currentSession = name; },
    setMode: () => {},
    setInputMode: () => {},
    setSessionList: () => {},
    setSelectedIndex: () => {},
    exit: () => process.exit(0),
  }),
);

// Branch: display layer only
if (headless) {
  if (!initialPrompt) {
    console.error('Error: --headless requires a prompt argument');
    process.exit(1);
  }

  const { runHeadless } = await import('./headless.js');
  await runHeadless(agent, initialPrompt, sessionName, resumeRecent);
  process.exit(0);
}

// Start TUI
render(<App
  agent={agent}
  config={config}
  version={VERSION}
  promptFiles={promptFiles}
  initialSession={initialSession}
  initialPrompt={initialPrompt}
  sessionName={sessionName}
  resumeRecent={resumeRecent}
  agentRegistry={sharedAgentRegistry}
/>, { exitOnCtrlC: false });
