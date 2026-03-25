#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent } from '../agent/loop.js';
import { getModelConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(await import('fs/promises').then(fs => fs.readFile(packagePath, 'utf-8')));
const VERSION = packageJson.version;

// Parse CLI arguments
const args = process.argv.slice(2);
let modelOverride: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--version' || arg === '-v') {
    console.log(`Mini Code v${VERSION}`);
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    console.log('Mini Code - A minimal coding agent\n');
    console.log('Usage:');
    console.log('  minicode [options]\n');
    console.log('Options:');
    console.log('  --model <spec>   Model specification (e.g., glm-4.7@zhipu)');
    console.log('  --version, -v    Show version');
    console.log('  --help, -h       Show this help');
    process.exit(0);
  } else if (arg === '--model') {
    modelOverride = args[++i];
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Priority: CLI args > MODEL env var > config.json
const modelConfig = await getModelConfig(modelOverride ?? process.env.MODEL);

if (!modelConfig) {
  console.error('Error: No valid model configuration found. Please set model in config.json (format: "model@provider")');
  process.exit(1);
}

const agent = new Agent(modelConfig.apiKey, modelConfig.baseURL, modelConfig.model);

function showBanner(config: { provider: string; model: string; baseURL?: string }) {
  console.log(`Mini Code v${VERSION}`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Model: ${config.model}`);
  console.log('---');
}

function ask(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  showBanner(modelConfig!);

  while (true) {
    const input = await ask('> ');
    if (input === 'exit') break;
    if (!input.trim()) continue;

    await agent.run(input);
    console.log();
  }

  rl.close();
}

main().catch(console.error);
