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

function showBanner() {
  console.log();
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║                    Coding Agent                       ║');
  console.log('  ╠═══════════════════════════════════════════════════════╣');
  console.log(`  ║  Provider: ${providerName.padEnd(30)} ║`);
  console.log(`  ║  Model:    ${(providerConfig!.model || 'default').padEnd(30)} ║`);
  console.log(`  ║  BaseURL:  ${(providerConfig!.baseURL || 'N/A').substring(0, 30).padEnd(30)} ║`);
  console.log('  ╠═══════════════════════════════════════════════════════╣');
  console.log('  ║  Type "exit" to quit                                 ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log();
}

function ask(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  showBanner();

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
