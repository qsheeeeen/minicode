# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
npm run dev          # Development mode via tsx (TUI)
npm run build        # TypeScript compile to dist/
npm run start        # Run built TUI from dist/
npm run start "prompt"  # Run with initial prompt
```

No test framework or linter is configured.

## Architecture

A minimal coding agent with **ink-based TUI**, tool use, and session persistence. All interaction happens through the TUI — there is no separate console mode.

### Source Layout

- `src/cli.tsx` — ink React app entry. Parses CLI args, creates Agent with CallbackDisplay, manages TUI state (messages, streaming, sessions, input)
- `src/agent.ts` — Core `Agent` class. Owns the conversation loop, delegates to services
- `src/config.ts` — Provider-based model config from `~/.minicode/config.json`. Model specifier format: `model@provider`
- `src/llm/anthropic.ts` — Thin wrapper around `@anthropic-ai/sdk`. Handles chat with tools and optional extended thinking
- `src/tools/` — Tool implementations + `ToolRegistry`
- `src/services/` — Cross-cutting services (`TokenManager`, `CompressionService`)
- `src/cli/commands.ts` — `CommandRegistry` for `/` commands (exit, compress, new, rename, resume)
- `src/utils/` — Display adapters, session persistence, session-to-display conversion
- `src/components/Message.tsx` — Single React component rendering messages by role

### Core Loop (`Agent.run()`)

1. Push user message, then loop: send messages + tool defs to LLM
2. First pass: collect text blocks and tool_use blocks from response
3. Display text via streaming, then show tool call names
4. Second pass: execute all tools in parallel via `Promise.allSettled()`
5. Push tool results as user messages, repeat until no tool calls
6. Track tokens via `TokenManager`, auto-compress when exceeding threshold ratio
7. Auto-save session after each complete exchange

### Key Patterns

**Registry pattern** — Both tools and TUI commands use a `Map<string, T>` registry with `register()`/`get()`/`getAll()`. Tools are registered in `Agent` constructor; commands are registered in `commands.ts` module scope. `ToolRegistry` also supports `autoDiscover()` for directory-based loading.

**Display adapter** — `DisplayAdapter` interface abstracts output. `CallbackDisplay` fires React state callbacks for TUI. `ConsoleDisplay` writes to stdout as fallback. The agent only calls display methods — it never touches React state directly.

**Service injection** — `Agent` constructor accepts optional `TokenManager` and `CompressionService` overrides (defaults to `*Impl` classes). This enables testing without real API calls.

**Session display bridge** — `SessionDisplay`/`SessionDisplayImpl` converts raw `SessionData` (Anthropic message format) into `DisplayMessage[]` for TUI rendering, handling the mismatch between tool_use blocks and display roles.

### Config Format

`~/.minicode/config.json` (not tracked):

```json
{
  "providers": {
    "anthropic": { "apiKey": "...", "baseURL": "...", "model": "claude-sonnet-4-5" },
    "zhipu": {
      "apiKey": "...",
      "baseURL": "...",
      "models": {
        "glm-4.7": { "contextLength": 128000 },
        "glm-5.1": { "contextLength": 200000 }
      }
    }
  },
  "model": "glm-5.1@zhipu",
  "compressionThreshold": 0.8,
  "thinking": true,
  "thinkingTokens": 20000
}
```

Priority: CLI `--model` arg > `MODEL` env var > config `model` field.

### Adding a Tool

1. Create file in `src/tools/` exporting a `ToolDef` (interface defined in `src/tools/index.ts`):

```typescript
export const myTool: ToolDef = {
  name: string,
  description: string,
  input_schema: Record<string, unknown>,
  format?: (args) => string,    // Display string, e.g. "Bash(ls -la)"
  execute: (args) => Promise<string>
};
```

2. Register in `Agent` constructor: `this.toolRegistry.register(myTool)`
3. Export from `src/tools/index.ts`

### TUI Commands

Handled by `CommandRegistry` in `src/cli/commands.ts`. Each command gets a `CommandContext` with agent, session manager, and React state setters. To add a command: call `commandRegistry.register({ name, description, handler })` in that file.

### TUI Styling

`Message` component renders by role: user=dim, assistant=white, tool call=yellow, tool result=dim, system=`[System]` gray, error=`[Error]` red. Tool calls are detected by matching known tool names (`Read`, `Write`, `Edit`, `Bash`) followed by `(`. No emoji.

### Sessions

Stored as JSON in `~/.minicode/sessions/<project-hash>/` (MD5 of cwd, 12 chars). Include messages + token count. Auto-saved after each exchange.
