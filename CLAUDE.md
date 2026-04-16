# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
npm run dev          # Development mode via tsx (TUI)
npm run build        # TypeScript compile to dist/
npm run start        # Run built TUI from dist/
npm run start "prompt"  # Run with initial prompt
npm run start -- --headless "prompt"  # Headless mode (no TUI, stdout output)
```

## Conventions

- **Module system:** ESM (`"type": "module"`) with Node16 module resolution. All imports use `.js` extensions (e.g. `import { foo } from './bar.js'` for `bar.ts`).
- **Project goal:** Self-bootstrapping — use minicode to develop minicode itself.
- **Config format:** `model@provider` specifier (e.g. `claude-sonnet-4-5@anthropic`). Priority: CLI `--model` > `MODEL` env var > config `model` field.
- **Verification:** All features and fixes must be self-tested in headless mode (`npm run start -- --headless "prompt"`) before reporting complete.

## Architecture

```
src/
├── cli.tsx              # Entry point: CLI args, config loading, React app bootstrap
├── agent.ts             # Agent class with streaming tool-execution loop
├── messages.ts          # AgentMessage model + MessageStore (single source of truth)
├── config.ts            # Multi-provider config loader (model@provider)
├── cli/
│   ├── args.ts          # CLI argument parsing
│   ├── headless.ts      # Headless runner (non-interactive, stdout output)
│   ├── commands/        # CommandRegistry + builtin / commands
│   └── tui.tsx          # Main App component, multi-agent hooks, input handling
├── components/
│   └── Message.tsx      # Message display by role
├── llm/
│   └── anthropic.ts     # Anthropic SDK wrapper (streaming + thinking)
├── services/
│   ├── agent-registry.ts     # Multi-agent coordination (IDs "1"-"9")
│   ├── token-manager.ts      # Token tracking, triggers compression
│   └── compression-service.ts # LLM-based conversation summarization
├── tools/
│   ├── index.ts         # ToolDef interface + exports
│   ├── registry.ts      # ToolRegistry (Map<string, ToolDef>)
│   ├── read.ts / write.ts / edit.ts / bash.ts  # Core tools
│   └── agent.ts         # Sub-agent delegation tool
└── utils/
    ├── diff.ts          # Unified diff generation
    ├── display.ts       # DisplayAdapter interface + CallbackDisplay/ConsoleDisplay/RecordDisplay
    ├── prompts.ts       # Global + project prompt loading (MINICODE.md)
    ├── session.ts       # SessionManager (v1/v2 format, per-project isolation)
    └── session-display.ts # Legacy v1 session conversion
```

### Core Flow

1. User input → Agent adds `AgentMessage` to `MessageStore`, sends `store.toLLMMessages()` to LLM
2. LLM responds with text + tool_use blocks (streamed to TUI via `DisplayAdapter`)
3. Tool calls execute in parallel (`Promise.allSettled`); results written back to store
4. Store mutations fire `onChange` → TUI re-renders from `store.toDisplayMessages()`
5. Session auto-saved after each exchange; token usage tracked with threshold-based compression

### Key Design Decisions

- **Unified Message Model:** `AgentMessage` has an `inContext` flag — `toLLMMessages()` only sends flagged messages, `toDisplayMessages()` shows all. This lets the UI display compressed/hidden context while keeping the LLM view clean.
- **Registry Pattern:** Both tools (`ToolRegistry`) and commands (`CommandRegistry`) use `Map<string, T>` with `register()`/`get()`/`getAll()`. Tools registered in `Agent` constructor; commands in `commands/builtin.ts`.
- **Display Adapter:** `DisplayAdapter` abstracts output (`status()`, `error()`, `updateTokenCount()`). `CallbackDisplay` bridges to React state; `ConsoleDisplay` for fallback; `RecordDisplay` captures events for testing. Tools get a `ToolDisplayHandle` via `context.display` for real-time slot updates.
- **Headless Mode:** `--headless` flag runs agent without TUI. Output matches TUI content (user, assistant, thinking, tool calls+results, status, error) but as plain text. Uses `elementToText()` to extract text from React elements.
- **Context Injection:** User/project prompts (from `MINICODE.md`) merged into system prompt via `getSystemPrompt()`. Never injected as fake conversation turns.
- **Session Isolation:** Sessions stored per-project using MD5 hash of cwd in `~/.minicode/sessions/<hash>/`.

## Adding a Tool

1. Create file in `src/tools/` implementing `ToolDef` (interface in `src/tools/index.ts`):
   ```typescript
   import { ToolDef, ToolResult, ToolExecutionContext } from './index.js';

   export const myTool: ToolDef = {
     name: 'my_tool',
     description: 'What it does',
     input_schema: { /* JSON Schema */ },
     format: (args) => <Text>MyTool({JSON.stringify(args)})</Text>,  // optional TUI display
     execute: async (args, context?: ToolExecutionContext): Promise<ToolResult> => {
       return { output: 'result for LLM', display: <Text dimColor>done</Text> };
     }
   };
   ```
2. Export from `src/tools/index.ts`
3. Register in `Agent` constructor tool list
