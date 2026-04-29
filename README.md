# minicode

A minimal coding agent powered by LLMs. Simple, opinionated, hackable.

**Goal:** Achieve self-bootstrapping — use minicode to develop minicode itself.

## Features

- **ink-based TUI** — React for CLIs, full terminal UI with streaming, thinking display, and context usage bar
- **Tool use** — read, write, edit, bash, agent (sub-agent delegation)
- **Multi-agent** — spawn parallel sub-agents, switch views with Ctrl+number
- **Multi-provider** — Anthropic, Zhipu, or any Anthropic-compatible API via `model@provider` spec
- **Session persistence** — auto-save, resume, rename, per-project isolation
- **Smart compression** — LLM-based conversation summarization at configurable token threshold
- **Extended thinking** — configurable thinking budget with dimmed streaming display
- **Project prompts** — global (`~/.minicode/MINICODE.md`) and per-project (`./MINICODE.md`) prompt files

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
     "promptFile": "MINICODE.md"
   }
   ```

   Model specifier format: `model@provider`. Each provider can define multiple models with per-model overrides (e.g. `contextLength`).

   Priority: CLI `--model` > `MODEL` env var > config `model` field.

2. Install and run:

   ```bash
   npm install
   npm run dev       # Development mode (tsx)
   npm run build     # Compile to dist/
   npm run start     # Run built version
   ```

## Usage

```bash
minicode                          # Start TUI with new session
minicode "list files"             # Start with initial prompt
minicode --model glm-4.7@zhipu   # Override model
minicode --session my-project     # Use named session
minicode --resume                 # Resume most recent session
```

### TUI Commands

| Command | Description |
|---------|-------------|
| `/new <name>` | Create new session |
| `/resume` | List sessions (arrow keys + Enter) |
| `/resume <name>` | Load specific session |
| `/rename <name>` | Rename current session |
| `/compress` | Compress conversation history |
| `/clear` | Clear history and start fresh |
| `/plan` | Generate executable plan from discussion |
| `/test` | Run a simple test across all tools |
| `/exit` | Quit (or Ctrl+C) |

### Multi-Agent

When the main agent delegates sub-tasks via the `agent` tool, sub-agents run in parallel. Switch between agent views:

- **Ctrl+1** — return to main agent
- **Ctrl+2..9** — view sub-agent output

The header shows agent tabs (`[M] [2] [3]`) with the active one highlighted.

## Architecture

```
src/
├── cli.tsx              # TUI entry point, CLI args, React app
├── agent.ts             # Agent class with tool execution loop
├── messages.ts          # Unified AgentMessage model + MessageStore
├── config.ts            # Multi-provider config loader
├── cli/
│   ├── args.ts          # CLI argument parsing and help
│   ├── commands/        # CommandRegistry + builtin / commands
│   │   ├── index.ts     # CommandRegistry class
│   │   └── builtin.ts   # Command registrations
│   └── tui.tsx          # Main App component with multi-agent hooks
├── components/
│   └── Message.tsx      # Message display component by role
├── llm/
│   └── anthropic.ts     # Anthropic SDK wrapper (streaming + thinking)
├── services/
│   ├── agent-registry.ts     # Multi-agent coordination and ID allocation
│   ├── token-manager.ts      # Token tracking and compression triggers
│   └── compression-service.ts # LLM-based conversation summarization
├── tools/
│   ├── index.ts         # Tool exports and ToolDef interface
│   ├── registry.ts      # ToolRegistry (register/get/getAll)
│   ├── read.ts          # File reading
│   ├── write.ts         # File writing
│   ├── edit.ts          # Surgical text replacement
│   ├── bash.ts          # Command execution
│   └── agent.ts         # Sub-agent delegation tool
└── utils/
    ├── diff.ts               # Unified diff generation
    ├── display.ts            # StreamDisplay + NotificationDisplay + StateDisplay
    ├── prompts.ts            # Global and project prompt loading
    ├── session.ts            # SessionManager for persistence (v1/v2)
    └── session-display.ts    # Legacy v1 session → display message conversion
```

### Core Flow

1. User input → Agent adds message to `MessageStore`, sends `store.toLLMMessages()` to LLM
2. LLM responds with text + tool_use blocks (streamed to TUI via `DisplayAdapter`)
3. Text/thinking streams to TUI; tool_use added to store; tools execute in parallel (`Promise.allSettled`)
4. Store updates fire `onChange` → TUI re-renders from `store.toDisplayMessages()`
5. Session auto-saved (v2 format with `agentMessages`) after each exchange
6. Token usage tracked; progress bar in status bar; auto-compresses when exceeding threshold
7. Sub-agents can be spawned via the `agent` tool, managed by `AgentRegistry`

### Adding a Tool

Create a file in `src/tools/` implementing the `ToolDef` interface:

```typescript
import React from 'react';
import { Text } from 'ink';
import { ToolDef, ToolResult, ToolExecutionContext } from './index.js';

export const myTool: ToolDef = {
  name: 'my_tool',
  description: 'What it does',
  input_schema: { /* JSON Schema */ },
  format: (args) => <Text>MyTool({JSON.stringify(args)})</Text>,
  execute: async (args, context?: ToolExecutionContext): Promise<ToolResult> => {
    // context.registry — AgentRegistry for sub-agent access
    // context.config — parent AgentConfig
    // context.display — ToolDisplayHandle for real-time slot updates
    return { output: 'result for LLM', display: <Text dimColor>done</Text> };
  }
};
```

Register in `Agent` constructor and export from `src/tools/index.ts`.

### Key Patterns

- **Registry pattern** — Tools and TUI commands both use `Map<string, T>` registries with `register()`/`get()`/`getAll()`
- **Display adapter** — `DisplayAdapter` interface abstracts output with slot-based tool display (`createSlot`/`updateSlot`); `CallbackDisplay` for TUI, `ConsoleDisplay` for fallback
- **Service injection** — `Agent` accepts optional `TokenManager`, `CompressionService`, and `AgentRegistry` overrides
- **Session isolation** — Sessions stored per-project using MD5 hash of cwd (`~/.minicode/sessions/<hash>/`)

## License

ISC
