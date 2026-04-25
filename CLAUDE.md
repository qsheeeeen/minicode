# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev           # Run in dev mode via tsx (no build needed)
npm run build         # Compile TypeScript to dist/
npm run start         # Run compiled version from dist/
```

## Testing

```bash
npm test          # Run Vitest in watch mode
npm run test:run  # Run tests once (also used for CI)
```

Test files are co-located with source: `src/**/*.test.ts`. Coverage is output to `coverage/`.

## Architecture

minicode is a minimal coding agent with an ink-based TUI. The codebase is pure TypeScript with React JSX for the terminal UI.

### Entry Point & Composition Root

`src/cli.tsx` is the single entry point. It parses CLI args, loads config, creates one `Agent` instance, then branches into TUI mode (`src/cli/tui.tsx`) or headless mode (`src/cli/headless.ts`).

### Core Loop

The `Agent` class (`src/agent.ts`) drives the conversation loop:
1. User message → `MessageStore.add()` → `store.toLLMMessages()` sent to LLM
2. LLM streams response (text + tool_use blocks) via `DisplayAdapter`
3. Tool calls execute in parallel with `Promise.allSettled`
4. `MessageStore.onChange` triggers TUI re-render from `store.toDisplayMessages()`
5. Session auto-saved after each exchange via `SessionManager`

### Key Abstractions

- **`MessageStore`** (`src/messages.ts`) — Unified message model (`AgentMessage`) with conversion methods for LLM API format and TUI display format
- **`ToolRegistry`** (`src/tools/registry.ts`) — `Map<string, ToolDef>` registry pattern. All tools implement `ToolDef` interface (`name`, `description`, `input_schema`, `execute`, optional `format`, `requires`, `requiresPermission`)
- **`DisplayAdapter`** (`src/utils/display.ts`) — Abstract output interface. `ConsoleDisplay` for headless, `CallbackDisplay` for TUI. Includes slot-based tool display (`createSlot`/`updateSlot`)
- **`AgentRegistry`** (`src/services/agent-registry.ts`) — Multi-agent coordination: ID allocation, parent-child lookup, parallel sub-agent spawning via the `agent` tool
- **`CommandRegistry`** (`src/cli/commands/index.ts`) — Same `Map<string, T>` registry pattern for TUI `/` commands, registered in `src/cli/commands/builtin.ts`

### Config System

`src/config.ts` — Multi-provider config loaded from `~/.minicode/config.json`. Model specifier format: `model@provider`. Priority: CLI `--model` > `MODEL` env var > config file. Each provider defines `apiKey`, `baseURL`, and per-model overrides (e.g., `contextLength`). Config options include `thinking` (boolean) and `effort` (`low` | `medium` | `high` | `xhigh` | `max`) for reasoning control.

### Session Persistence

`src/utils/session.ts` — Sessions stored per-project at `~/.minicode/sessions/<md5-of-cwd>/` in v2 format (`agentMessages` array). Supports auto-save, resume, rename, list.

### LLM Layer

`src/llm/anthropic.ts` — Thin wrapper around `@anthropic-ai/sdk` with streaming support, extended thinking, and output_config effort control. API docs: https://platform.claude.com/docs/en/api/messages

## TypeScript Conventions

- ES2022 target, Node16 module resolution, strict mode
- All imports use `.js` extensions (Node16 ESM convention)
- JSX: `react-jsx` (no explicit React imports needed in component files)
- Build output: `dist/`
