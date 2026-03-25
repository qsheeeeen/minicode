# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
# Development mode
npm run dev

# Build to dist/
npm run build

# Run built CLI
npm run start

# Direct prompt mode
npm run start "read package.json"
npm run start -- --model glm-4.7@zhipu "list files"
```

## Architecture

A minimal coding agent with REPL interface, tool use, and session persistence.

**Structure:**
```
src/
├── cli.ts           # REPL entry point, CLI args, session commands
├── agent.ts         # Agent class with two-pass tool execution loop
├── config.ts        # Provider-based model config loader
├── tools/           # Tool implementations (read, write, edit, bash)
├── utils/
│   ├── logger.ts    # Emoji-prefixed logging (ℹ️🔧⏳❌)
│   └── session.ts   # SessionManager class for persistence
└── llm/
    └── anthropic.ts # Anthropic SDK wrapper
```

**Core Flow (Agent.run()):**
1. Send messages + tool definitions to LLM
2. **First pass:** Display text responses, collect tool calls
3. **Second pass:** Execute all tools in parallel via `Promise.allSettled()`
4. Push tool results as user messages, repeat until no more tool calls
5. Auto-save session after each complete exchange

**Sessions:**
- Stored in `~/.minicode/sessions/<project-hash>/`
- One SessionManager instance per project (hash based on cwd)
- REPL/direct mode create new sessions by default
- Use `--session <name>` or `--resume` to specify

**REPL Commands (must start with `/`):**
- `/new <name>` - Create new session
- `/resume [n|name]` - List and select session, or load by name/number
- `/rename <name>` - Rename current session
- `/compress` - Compress conversation history
- `/exit` - Quit

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

Model specifier: `model@provider` or just `model`. Priority: CLI arg > MODEL env var > config.

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

Register in `src/agent.ts` constructor and export from `src/tools/index.ts`.

## Logging

Use emoji-prefixed functions from `utils/logger.ts`:
- `system()` - ℹ️ System messages
- `toolCall()` - 🔧 Tool calls
- `progress()` - ⏳ Progress (no newline)
- `error()` - ❌ Errors
- `raw()` - Plain output
