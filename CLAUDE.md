# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
# Run in development mode (no watch mode, manual restart required)
npm run dev

# Build to dist/
npm run build

# Run built CLI
npm run start

# Direct prompt mode (non-interactive)
npm run start "read package.json"
npm run start -- --model glm-4.7@zhipu "list files"
```

## Architecture

A minimal coding agent with tool use. Entry point is a REPL CLI that can also run single prompts.

**Entry point:** `src/cli/index.ts` - Handles CLI args, config loading, and REPL/direct modes

**Core loop:** `src/agent/loop.ts` - Agent class with two-pass execution:
1. First pass: Collects all tool calls, displays text blocks
2. Second pass: Executes all tools in parallel via `Promise.allSettled()`, pushes results back

**LLM layer:** `src/llm/anthropic.ts` - Thin Anthropic SDK wrapper

**Tools:** `src/tools/*.ts` - Each exports `{ name, description, input_schema, format, execute }`

## Config Format

`config.json` (not tracked) uses provider-based model selection:

```json
{
  "providers": {
    "anthropic": { "apiKey": "...", "baseURL": "...", "model": "claude-sonnet-4-5" },
    "zhipu": { "apiKey": "...", "baseURL": "...", "model": "glm-4.7" }
  },
  "model": "glm-4.7@zhipu"
}
```

Model specifier format: `model@provider` or just `model` (uses first provider).

Priority for model selection: CLI `--model` arg > `MODEL` env var > config.json.

## Adding a Tool

Tool definition in `src/tools/`:

```typescript
export const toolName = {
  name: string,
  description: string,
  input_schema: Record<string, unknown>,
  format?: (args) => string,  // Display format, e.g., "Bash(ls -la)"
  execute: (args) => Promise<string>
};
```

Register in `src/agent/loop.ts` constructor and export from `src/tools/index.ts`.

## CLI Arguments

- `--model <spec>` - Override model (e.g., `glm-4.7@zhipu`)
- `--version, -v` - Show version
- `--help, -h` - Show usage
- `[prompt]` - Direct prompt mode (runs and exits)
