#!/usr/bin/env node
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { render } from 'ink';
import { loadAllConfig } from './config.js';
import { Agent } from './agent.js';
import { SessionManager } from './utils/session.js';
import { createLogger } from './utils/logger.js';
import { parseArgs, type PermissionMode } from './cli/args.js';
import { loadGlobalPrompt, loadProjectPrompt } from './utils/prompts.js';
import { SkillRegistry } from './services/skill-registry.js';
import { builtinSkills } from './services/builtin-skills.js';
import { App } from './cli/tui.js';
import { commandRegistry } from './cli/commands/index.js';

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

// Load global and project prompts
const [globalPrompt, projectPrompt] = await Promise.all([
  loadGlobalPrompt(),
  loadProjectPrompt(process.cwd(), config.promptFile)
]);
const promptFiles: string[] = [];
if (globalPrompt) promptFiles.push('~/.minicode/MINICODE.md');
if (projectPrompt) promptFiles.push(`./${config.promptFile}`);
const userPrompt = [globalPrompt, projectPrompt].filter(Boolean).join('\n\n');

const sessionManager = new SessionManager();

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

const skillRegistry = new SkillRegistry();
for (const skill of builtinSkills) {
  skillRegistry.register(skill);
}

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

// Create Agent (composition root — single creation point)
const agent = new Agent({
  apiKey: config.model!.apiKey,
  baseURL: config.model!.baseURL,
  model: config.model!.model,
  contextLength: config.model!.contextLength,
  compressionThresholdRatio: config.compressionThreshold,
  thinkingEnabled: config.thinking.enabled,
  effort: config.thinking.effort,
  userPrompt,
  sessionManager,
  permissionMode,
  currentSession: initialSession,
  logger,
  skillRegistry,
});

// Set shared command resolver so both headless and TUI use the same resolve path
agent.setCommandResolver((input: string) =>
  commandRegistry.parseAndExecute(input, {
    agent,
    sessionManager,
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

  const { runHeadless } = await import('./cli/headless.js');
  await runHeadless(agent, initialPrompt, sessionManager, sessionName, resumeRecent);
  process.exit(0);
}

// Start TUI
render(<App
  agent={agent}
  config={config}
  version={VERSION}
  promptFiles={promptFiles}
  initialSession={initialSession}
  sessionManager={sessionManager}
  initialPrompt={initialPrompt}
  sessionName={sessionName}
  resumeRecent={resumeRecent}
/>, { exitOnCtrlC: false });
