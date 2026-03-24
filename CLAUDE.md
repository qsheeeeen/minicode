# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
# Run in development mode (watch file changes not supported, use manual restart)
npm run dev

# Build to dist/
npm run build

# Run built CLI
npm run start
```

## Architecture

A minimal coding agent built with TypeScript. Uses Anthropic's Claude API with tool use.

**Entry point:** `src/cli/index.ts` - readline REPL interface

**Core loop:** `src/agent/loop.ts` - Agent class that:
- Maintains message history in memory
- Handles Claude responses with tool_use blocks
- Executes tools and feeds results back to Claude
- Loops until no more tool calls

**LLM layer:** `src/llm/anthropic.ts` - Thin wrapper around Anthropic SDK

**Tools:** `src/tools/` - Each tool exports a `{ name, description, input_schema, execute }` object. Available tools: read, write, edit, bash.

**Config:** `src/config.ts` - Loads `config.json` from project root (not tracked in git). See `config.example.json`.

## Adding a New Tool

1. Create file in `src/tools/` exporting a tool definition
2. Register in Agent constructor (`src/agent/loop.ts`)
3. Export from `src/tools/index.ts`

Tool definition shape:
```typescript
{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;  // Anthropic tool schema
  execute: (args: any) => Promise<string>;
}
```
