#!/usr/bin/env node
import readline from 'readline';
import { Agent } from '../agent/loop.js';
import { getModelConfig } from '../config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const modelConfig = await getModelConfig(process.env.MODEL);

if (!modelConfig) {
  console.error('Error: No valid model configuration found. Please set model in config.json (format: "model@provider")');
  process.exit(1);
}

const agent = new Agent(modelConfig.apiKey, modelConfig.baseURL, modelConfig.model);

function showBanner(config: { provider: string; model: string; baseURL?: string }) {
  console.log(`Mini Code v1.0.0`);
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
