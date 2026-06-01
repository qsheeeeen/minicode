# minicode

A minimal coding agent powered by LLMs with TUI. Simple, opinionated, hackable.

**Goal:** Achieve self-bootstrapping — use minicode to develop minicode itself.

## Features

- **ink-based TUI** — React for CLIs, full terminal UI with streaming, thinking display, and context usage bar
- **Tool use** — read, write, edit, bash, agent (sub-agent delegation), activate_skill
- **Multi-agent** — spawn parallel sub-agents, switch views with Ctrl+O
- **Multi-provider** — Anthropic, Zhipu, or any Anthropic-compatible API via `model@provider` spec
- **Session persistence** — auto-save, resume, rename, per-project isolation
- **Smart compression** — LLM-based conversation summarization at configurable token threshold
- **Extended thinking** — configurable thinking budget with dimmed streaming display
- **Permission modes** — manual (per-tool), yolo (allow all), auto (LLM decides)
- **Project prompts** — global (`~/.minicode/AGENTS.md`) and per-project (`./AGENTS.md`) prompt files
- **Skills** — extendable workflow automation via agentSkills.io format
- **Headless mode** — non-TUI operation for scripting and automation

## Setup

1. Create config at `~/.minicode/config.json`:

   ```json
   {
     "providers": {
       "anthropic": {
         "apiKey": "sk-ant-...",
         "baseURL": "https://api.anthropic.com",
         "models": {
           "claude-sonnet-4-5": {},
           "claude-opus-4": { "contextLength": 200000 }
         }
       }
     },
     "model": "claude-sonnet-4-5@anthropic",
     "compressionThreshold": 0.8,
     "thinking": true,
     "thinkingTokens": 20000,
     "promptFile": "AGENTS.md"
   }
   ```

   Model specifier format: `model@provider`. Each provider can define multiple models with per-model overrides (e.g. `contextLength`).

   Priority: CLI `--model` > `MODEL` env var > config `model` field.

2. Install and run:

   ```bash
   bun install
   bun run dev       # Development mode (Bun native TS/TSX)
   bun run build    # Compile to dist/
   bun run start    # Run built version
   ```

## CLI Usage

```bash
minicode                          # Start TUI with new session
minicode "list files"             # Start with initial prompt
minicode --model glm-4.7@zhipu   # Override model
minicode --session my-project     # Use named session
minicode --resume                 # Resume most recent session
minicode -H "ls -la"              # Headless mode (no TUI)
minicode -H --perm yolo "ls"     # Headless with permission mode
```

Model priority: CLI `--model` > `MODEL` env var > config `model` field.

### Slash Commands

| Command           | Description                                         |
| ----------------- | --------------------------------------------------- |
| `/new [name]`     | Create new session                                  |
| `/resume`         | List sessions (arrow keys + Enter)                  |
| `/resume <name>`  | Load specific session                               |
| `/rename <name>`  | Rename current session                              |
| `/compress`       | Compress conversation history                       |
| `/clear`          | Clear history and start fresh                       |
| `/effort [level]` | Set thinking effort (low\|medium\|high\|xhigh\|max) |
| `/plan`           | Generate executable plan from discussion            |
| `/test`           | Run a simple test across all tools                  |
| `/skills`         | List available skills                               |
| `/model`          | Switch model/provider via UI                        |
| `/exit`           | Quit (or Ctrl+C)                                    |

**Permission mode:** Shift+Tab cycles between manual/yolo/auto

### Multi-Agent

When the main agent delegates sub-tasks via the `agent` tool, sub-agents run in parallel. Switch between agent views with **Ctrl+O**.

## Architecture

```
src/
├── cli.tsx              # CLI entry point — renders App, parses args, starts TUI/headless
├── tui.tsx              # Top-level TUI App component + hooks
├── headless.ts          # Headless (non-TUI) mode runner
├── args.ts              # CLI argument parsing (yargs)
├── agent.ts             # Agent class with tool execution loop
├── messages.ts          # MessageStore (API + display message model)
├── config.ts            # Multi-provider config loader
├── tui/
│   ├── Message.tsx      # Message display component by role
│   ├── MessageList.tsx  # Scrollable message list
│   ├── Header.tsx       # App header with model/session info
│   ├── StatusBar.tsx    # Bottom status bar with token usage
│   ├── InputArea.tsx    # Main input area with mode switching
│   ├── ModalPrompter.tsx # Modal input prompts
│   ├── inputs.tsx       # Input component variants (modal, inline, password)
│   ├── tool-display.tsx # Tool call/result rendering
│   └── store.tsx        # TUI state management with useReducer
├── commands/
│   └── index.ts         # CommandRegistry class + builtin slash commands
├── skills/
│   └── index.ts         # SkillRegistry class + builtin skills
├── llm/
│   └── anthropic.ts     # AnthropicClient — streaming + non-streaming
├── services/
│   ├── agent-registry.ts    # Multi-agent coordination
│   ├── permission.ts        # PermissionService (manual/yolo/auto)
│   ├── token-manager.ts     # Token tracking + compression triggers
│   └── compression-service.ts # LLM-based conversation summarization
├── tools/
│   ├── index.ts             # ToolDef interface + registerTools helper
│   ├── registry.ts          # ToolRegistry (register/get/getAll)
│   ├── read.ts              # File reading
│   ├── write.ts             # File writing
│   ├── edit.ts              # Surgical text replacement
│   ├── bash.ts              # Command execution
│   ├── agent.ts             # Sub-agent delegation tool
│   └── activate_skill.ts    # Skill activation tool
└── utils/
    ├── diff.ts               # Unified diff generation
    ├── display.ts            # DisplayAdapter + CallbackDisplay + ConsoleDisplay
    ├── prompts.ts            # Global (~/.minicode/AGENTS.md) and project prompt loading
    ├── session.ts            # SessionManager (v1/v2 persistence) — module singleton
    ├── session-display.ts    # Legacy v1 session → display message conversion
    └── logger.ts             # pino-based session-scoped logging
```

### Core Flow

1. User input → Agent adds message to `MessageStore`, sends `store.toLLMMessages()` to LLM
2. LLM responds with text + tool_use blocks (streamed to TUI via `CallbackDisplay` or stdout in headless mode)
3. Text/thinking streams incrementally; tool_use blocks added to store; tools execute sequentially
4. Tool results are pushed as a single user turn with `tool_result` blocks
5. Store changes fire `onChange` → TUI re-renders from `store.toDisplayMessages()`
6. Session auto-saved (v2 format) after each exchange
7. Token usage tracked; progress bar in status bar; auto-compresses when exceeding threshold
8. Sub-agents spawned via `agent` tool, managed by `AgentRegistry`; switch with Ctrl+O

### Adding a Tool

Create a file in `src/tools/` implementing the `ToolDef` interface:

```typescript
import React from 'react';
import { Text } from 'ink';
import type { ToolDef } from './index.js';

export const myTool: ToolDef = {
  name: 'my_tool',
  description: 'What it does',
  input_schema: { /* JSON Schema */ },
  requiresPermission: true,    // optional: gate behind PermissionService
  formatCall: (args) => <Text>MyTool({JSON.stringify(args)})</Text>,
  formatResult: (output, input) => <Text dimColor>done</Text>,
  execute: async (args, context) => {
    // context.registry — AgentRegistry for sub-agent access
    // context.config — parent AgentConfig
    return { output: 'result for LLM' };
  }
};
```

Then register in `src/tools/index.ts`.

### Key Patterns

- **Two message layers** — `MessageParam[]` for LLM API, `DisplayMessage[]` for UI (`store.toDisplayMessages()`)
- **Display adapters** — `CallbackDisplay` for TUI (hooks into React state), `ConsoleDisplay` for headless/fallback, `RecordDisplay` for testing
- **Registry pattern** — Tools and commands use `Map<string, T>` with `register()`/`get()`/`getAll()`
- **Skill system** — agentSkills.io format: directory with `SKILL.md` (YAML frontmatter + body), loaded from `skillsDir`
- **Permission modes** — `manual` (per-tool prompt), `yolo` (allow all), `auto` (LLM decides)
- **Session isolation** — Per-project using MD5 hash of cwd (`~/.minicode/sessions/<hash>/`)

## License

MIT
