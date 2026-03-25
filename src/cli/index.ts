#!/usr/bin/env node
import readline from 'readline';
import { Agent } from '../agent/loop.js';
import { loadConfig, getProviderConfig } from '../config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const config = await loadConfig();
const providerName = process.env.PROVIDER || config.defaultProvider || 'anthropic';
const providerConfig = await getProviderConfig(providerName);

if (!providerConfig?.apiKey) {
  console.error(`Error: No API key found for provider "${providerName}". Please configure it in config.json`);
  process.exit(1);
}

const agent = new Agent(providerConfig.apiKey, providerConfig.baseURL, providerConfig.model);
console.log(`Using provider: ${providerName} (model: ${providerConfig.model || 'default'})\n`);

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
