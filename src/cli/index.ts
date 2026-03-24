#!/usr/bin/env node
import readline from 'readline';
import { Agent } from '../agent/loop.js';
import { loadConfig } from '../config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const config = await loadConfig();
if (!config.anthropicApiKey) {
  console.error('Error: No API key found. Please set anthropicApiKey in config.json');
  process.exit(1);
}

const agent = new Agent(config.anthropicApiKey, config.baseURL);

function ask(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('Coding Agent - Type "exit" to quit\n');

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
