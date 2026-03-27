# minicode

A minimal coding agent powered by LLMs. Simple, opinionated, hackable.

## Features

- ink-based TUI (React for CLIs) — no readline, full terminal UI
- Tool use: read, write, edit, bash
- Multi-provider support (Anthropic, Zhipu, any OpenAI-compatible API)
- Session persistence with auto-save and resume
- Conversation compression at configurable token threshold
- Extended thinking support

## Setup

1. Create config at `~/.minicode/config.json`:

   ```json
   {
     "providers": {
       "anthropic": {
         "apiKey": "sk-ant-...",
         "baseURL": "https://api.anthropic.com",
         "model": "claude-sonnet-4-5"
       }
     },
     "model": "claude-sonnet-4-5@anthropic",
     "compressionThreshold": 0.8,
     "thinking": true,
     "thinkingTokens": 20000
   }
   ```

   Model specifier format: `model@provider`. You can define multiple providers and switch between them.

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
| `/exit` | Quit (or Ctrl+C) |

## Architecture

```
src/
├── cli.tsx              # TUI entry point, CLI args, React app
├── agent.ts             # Agent class with tool execution loop
├── config.ts            # Multi-provider config loader
├── cli/
│   └── commands.ts      # CommandRegistry for / commands
├── components/
│   └── Message.tsx      # Message display component
├── llm/
│   └── anthropic.ts     # Anthropic SDK wrapper
├── services/
│   ├── token-manager.ts      # Token tracking and compression triggers
│   └── compression-service.ts # LLM-based conversation summarization
├── tools/
│   ├── index.ts         # Tool exports and ToolDef interface
│   ├── registry.ts      # ToolRegistry with auto-discovery
│   ├── read.ts          # File reading
│   ├── write.ts         # File writing
│   ├── edit.ts          # Surgical text replacement
│   └── bash.ts          # Command execution
└── utils/
    ├── display.ts            # DisplayAdapter (Console/Callback)
    ├── session.ts            # SessionManager for persistence
    └── session-display.ts    # Session data → display message conversion
```

### Core Flow

1. User input → Agent pushes message, sends to LLM with tool definitions
2. LLM responds with text + tool_use blocks
3. Text streams to TUI; tools execute in parallel (`Promise.allSettled`)
4. Tool results pushed back to LLM; loop continues until no tool calls
5. Session auto-saved after each exchange
6. Token usage tracked; auto-compresses when exceeding threshold

### Adding a Tool

Create a file in `src/tools/` implementing the `ToolDef` interface:

```typescript
import { ToolDef } from './index.js';

export const myTool: ToolDef = {
  name: 'my_tool',
  description: 'What it does',
  input_schema: { /* JSON Schema */ },
  format: (args) => `MyTool(${JSON.stringify(args)})`,
  execute: async (args) => { /* return string result */ }
};
```

Register in `Agent` constructor and export from `src/tools/index.ts`.
