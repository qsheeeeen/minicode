#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent } from '../agent/loop.js';
import { getModelConfig, getCompressionThreshold } from '../config.js';
import { listSessions, deleteSession, renameSession } from '../utils/session.js';

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
    console.log('  --model <spec>   Model specification (e.g., glm-4.7@zhipu)');
    console.log('  --version, -v    Show version');
    console.log('  --help, -h       Show this help');
    console.log('\nExamples:');
    console.log('  minicode                       # Start interactive mode');
    console.log('  minicode "read package.json"   # Run prompt directly');
    console.log('\nIn REPL mode:');
    console.log('  /compress or /c                # Compress conversation history');
    console.log('  /ls                            # List sessions');
    console.log('  /new <name>                    # Create new session');
    console.log('  /switch <name> or /s <name>    # Switch session');
    console.log('  /rm <name>                     # Delete session');
    console.log('  /rename <new-name>             # Rename current session');
    console.log('  exit                           # Quit');
    process.exit(0);
  } else if (arg === '--model') {
    modelOverride = args[++i];
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

  // Auto-load default session
  await agent.loadFromSession('default');
  showBanner(modelConfig!, agent.currentSession);

  while (true) {
    const input = await ask('> ');
    if (input === 'exit') break;
    if (!input.trim()) continue;

    // Handle special commands
    if (input === '/compress' || input === '/c') {
      await agent.compress();
      console.log();
      continue;
    }

    if (input === '/ls') {
      const sessions = await listSessions();
      console.log('Sessions:');
      for (const s of sessions) {
        const current = s === agent.currentSession ? ' (current)' : '';
        console.log(`  ${s}${current}`);
      }
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

    if (input.startsWith('/switch ') || input.startsWith('/s ')) {
      const name = input.startsWith('/switch ') ? input.slice(8).trim() : input.slice(3).trim();
      if (!name) {
        console.log('Usage: /switch <session-name> or /s <session-name>');
        console.log();
        continue;
      }
      const loaded = await agent.loadFromSession(name);
      if (loaded) {
        console.log(`Switched to session: ${name}`);
      } else {
        console.log(`Session not found: ${name} (use /new to create)`);
      }
      console.log();
      continue;
    }

    if (input.startsWith('/rm ')) {
      const name = input.slice(4).trim();
      if (!name) {
        console.log('Usage: /rm <session-name>');
        console.log();
        continue;
      }
      if (name === agent.currentSession) {
        console.log('Cannot delete current session');
        console.log();
        continue;
      }
      await deleteSession(name);
      console.log(`Deleted session: ${name}`);
      console.log();
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
  await agent.run(prompt);
}

// Direct prompt mode or REPL mode
if (directPrompt) {
  await runDirect(directPrompt);
} else {
  await runRepl();
}
