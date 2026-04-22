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

### Composition Root

`src/cli.tsx` is the single assembly point. It creates the `Agent` from `ResolvedConfig` and branches to the display layer:

```
cli.tsx → new Agent(config) → headless: agent.setDisplay(stdoutAdapter) + agent.run()
                             → TUI:      render(<App agent={agent}>)
```

TUI and headless only set the display adapter — they never construct or configure the Agent.

### Core Flow

1. User input → Agent adds `AgentMessage` to `MessageStore`, sends `store.toLLMMessages()` to LLM
2. LLM responds with text + tool_use blocks (streamed via `DisplayAdapter`)
3. Tool calls execute in parallel (`Promise.allSettled`); results written back to store
4. Store mutations fire `onChange` → display layer renders
5. Session saved at checkpoints: thinking complete, tool_use received, tool results complete, run finished

### DisplayAdapter — Service→User Interaction

`DisplayAdapter` is the interface between services and the user. It has a generic `confirm(req): Promise<boolean>` method that any service can use to ask yes/no questions. Currently used by `PermissionService` for tool execution approval:

- **TUI**: `CallbackDisplay.confirm()` sets React state, returns promise resolved by keypress
- **Headless**: `confirm()` always returns false
- **Sub-agents**: Use `ConsoleDisplay` with no `confirm()` — defaults to allow

This pattern is extensible: future services that need user input (e.g. "overwrite existing file?") use the same `display.confirm()`.

### Key Design Decisions

- **Unified Message Model:** `AgentMessage` has an `inContext` flag — `toLLMMessages()` only sends flagged messages, `toDisplayMessages()` shows all. Lets UI display compressed/hidden context while keeping the LLM view clean.
- **Registry Pattern:** Both tools (`ToolRegistry`) and commands (`CommandRegistry`) use `Map<string, T>` with `register()`/`get()`/`getAll()`.
- **PermissionService:** Built inside Agent from `permissionMode` config. Three modes: `yolo` (allow all), `manual` (via `display.confirm()`), `auto` (LLM decides). No UI dependency — uses the display adapter for interaction.
- **Context Injection:** User/project prompts (from `MINICODE.md`) merged into system prompt via `getSystemPrompt()`. Never injected as fake conversation turns.
- **Session Isolation:** Sessions stored per-project using MD5 hash of cwd in `~/.minicode/sessions/<hash>/`.
- **Sub-agents:** Created by the `agent` tool as isolated headless agents with `ConsoleDisplay`. Registered with `AgentRegistry`, auto-removed after completion.

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
