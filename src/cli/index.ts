#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent } from '../agent/loop.js';
import { getModelConfig, getCompressionThreshold } from '../config.js';
import { renameSession, getMostRecentSession, listSessionsWithInfo, SessionInfo } from '../utils/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(await import('fs/promises').then(fs => fs.readFile(packagePath, 'utf-8')));
const VERSION = packageJson.version;

// Parse CLI arguments
const args = process.argv.slice(2);
let modelOverride: string | undefined;
let directPrompt: string | undefined;
let sessionName: string | undefined;
let resumeRecent = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--version' || arg === '-v') {
    console.log(`Mini Code v${VERSION}`);
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    console.log('Mini Code - A minimal coding agent\n');
    console.log('Usage:');
    console.log('  minicode [options] [prompt]\n');
    console.log('Options:');
    console.log('  --model <spec>    Model specification (e.g., glm-4.7@zhipu)');
    console.log('  --session <name>  Session name (creates new or resumes existing)');
    console.log('  --resume          Resume most recent session');
    console.log('  --version, -v     Show version');
    console.log('  --help, -h        Show this help');
    console.log('\nExamples:');
    console.log('  minicode                        # Start interactive mode');
    console.log('  minicode "read package.json"    # Run prompt directly');
    console.log('  minicode --session feature-a    # Use specific session');
    console.log('  minicode --resume               # Resume most recent session');
    console.log('\nIn REPL mode:');
    console.log('  /compress                      # Compress conversation history');
    console.log('  /new <name>                    # Create new session');
    console.log('  /resume [number|name]          # List or resume session');
    console.log('  /rename <new-name>             # Rename current session');
    console.log('  /exit                          # Quit');
    process.exit(0);
  } else if (arg === '--model') {
    modelOverride = args[++i];
  } else if (arg === '--session') {
    sessionName = args[++i];
  } else if (arg === '--resume') {
    resumeRecent = true;
  } else if (!arg.startsWith('--')) {
    // Non-option argument is the prompt
    directPrompt = arg;
  }
}

// Priority: CLI args > MODEL env var > config.json
const modelConfig = await getModelConfig(modelOverride ?? process.env.MODEL);
const compressionThreshold = await getCompressionThreshold();

if (!modelConfig) {
  console.error('Error: No valid model configuration found. Please set model in config.json (format: "model@provider")');
  process.exit(1);
}

const agent = new Agent(
  modelConfig.apiKey,
  modelConfig.baseURL,
  modelConfig.model,
  modelConfig.contextLength,
  compressionThreshold
);

// Initialize session
if (sessionName) {
  // Specific session requested
  await agent.loadFromSession(sessionName);
} else if (resumeRecent) {
  // Resume most recent session
  const recent = await getMostRecentSession();
  if (recent) {
    await agent.loadFromSession(recent, true);
  } else {
    // No recent session, create new
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    agent.startNewSession(`repl-${timestamp}`);
  }
} else {
  // Create new session
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  agent.startNewSession(`repl-${timestamp}`);
}

function showBanner(config: { provider: string; model: string; baseURL?: string }, session: string) {
  console.log(`Mini Code v${VERSION}`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Model: ${config.model}`);
  console.log(`Session: ${session}`);
  console.log('---');
}

async function runRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let closed = false;
  rl.on('close', () => { closed = true; });

  function ask(query: string): Promise<string> {
    return new Promise(resolve => {
      if (closed) {
        process.exit(0);
      }
      rl.question(query, (answer) => {
        if (closed) {
          process.exit(0);
        }
        resolve(answer);
      });
    });
  }

  showBanner(modelConfig!, agent.currentSession);

  while (true) {
    const input = await ask('> ');
    if (input === '/exit') break;
    if (!input.trim()) continue;

    // Handle special commands
    if (input === '/compress') {
      await agent.compress();
      console.log();
      continue;
    }

    if (input.startsWith('/new ')) {
      const name = input.slice(5).trim();
      if (!name) {
        console.log('Usage: /new <session-name>');
        console.log();
        continue;
      }
      agent.startNewSession(name);
      console.log(`Created new session: ${name}`);
      console.log();
      continue;
    }

    if (input === '/resume' || input.startsWith('/resume ')) {
      const arg = input === '/resume' ? '' : input.slice(8).trim();

      // No argument - show numbered list and wait for selection
      if (!arg) {
        const sessions = await listSessionsWithInfo();
        if (sessions.length === 0) {
          console.log('No sessions found. Use /new to create one.');
          console.log();
          continue;
        }
        console.log('Sessions (most recent first):');
        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          const current = s.name === agent.currentSession ? ' (current)' : '';
          console.log(`  ${i + 1}. ${s.name}${current}`);
        }

        // Wait for user to select a number
        const selection = await ask('Select session number (or Enter to cancel): ');
        if (!selection.trim()) {
          console.log('Cancelled.');
          console.log();
          continue;
        }

        const num = parseInt(selection, 10);
        if (isNaN(num) || num < 1 || num > sessions.length) {
          console.log(`Invalid selection. Use 1-${sessions.length}`);
          console.log();
          continue;
        }

        const name = sessions[num - 1].name;
        rl.pause();
        console.log();
        const loaded = await agent.loadFromSession(name, true);
        rl.resume();

        if (!loaded) {
          console.log(`Failed to load session: ${name}`);
          console.log();
        }
        continue;
      }

      // Argument provided - direct load by name
      rl.pause();
      console.log();
      const loaded = await agent.loadFromSession(arg, true);
      rl.resume();

      if (!loaded) {
        console.log(`Session not found: ${arg} (use /new to create)`);
        console.log();
      }
      continue;
    }

    if (input.startsWith('/rename ')) {
      const newName = input.slice(8).trim();
      if (!newName) {
        console.log('Usage: /rename <new-name>');
        console.log();
        continue;
      }
      const oldName = agent.currentSession;
      await renameSession(oldName, newName);
      agent.currentSession = newName;
      console.log(`Renamed session: ${oldName} -> ${newName}`);
      console.log();
      continue;
    }

    await agent.run(input);
    console.log();
  }

  rl.close();
}

async function runDirect(prompt: string) {
  // Create a new session for direct mode
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionName = `direct-${timestamp}`;
  agent.startNewSession(sessionName);
  await agent.run(prompt);
}

// Direct prompt mode or REPL mode
if (directPrompt) {
  await runDirect(directPrompt);
} else {
  await runRepl();
}
