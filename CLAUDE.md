# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
# Development mode (TUI)
npm run dev

# Build to dist/
npm run build

# Run built TUI
npm run start

# Run with initial prompt
npm run start "list files"
```

## Architecture

A minimal coding agent with **ink-based TUI**, tool use, and session persistence.

**TUI-First Design:** The CLI uses ink (React for CLIs) for the interface. All interaction happens through the TUI - there is no separate console/direct mode.

**Structure:**
```
src/
├── cli.tsx              # TUI app entry point, CLI args
├── agent.ts             # Agent class with two-pass tool execution
├── config.ts            # Provider-based model config loader
├── components/
│   └── Message.tsx      # Message display component (user/assistant/tool/system/error)
├── tools/               # Tool implementations
│   ├── index.ts         # Tool exports
│   ├── read.ts          # File reading
│   ├── write.ts         # File writing
│   ├── edit.ts          # Surgical text replacement
│   └── bash.ts          # Command execution
├── utils/
│   ├── display.ts       # Display adapter abstraction (Console/Callback)
│   ├── session.ts       # SessionManager for persistence
│   └── logger.ts        # Legacy emoji logging (mostly unused)
└── llm/
    └── anthropic.ts     # Anthropic SDK wrapper
```

**Core Flow (Agent.run()):**
1. Send messages + tool definitions to LLM
2. **First pass:** Stream text responses, collect tool calls
3. **Second pass:** Execute all tools in parallel via `Promise.allSettled()`
4. Push tool results as user messages, repeat until no more tool calls
5. Auto-save session after each complete exchange

**Display System:**
- `DisplayAdapter` interface abstracts TUI vs console output
- `CallbackDisplay` - for TUI, uses React state callbacks
- `ConsoleDisplay` - fallback for debugging
- Messages flow: `onMessage` → adds to React state → rendered by `Message` component
- Streaming: `onStreamStart/Chunk/End` → temporary state → committed to messages

**TUI Commands (start with `/`):**
- `/new <name>` - Create new session
- `/resume` - List sessions (arrow keys + Enter to select)
- `/resume <name>` - Load specific session
- `/rename <name>` - Rename current session
- `/compress` - Compress conversation history
- `/exit` or `Ctrl+C` - Quit

## Config Format

`~/.minicode/config.json` (not tracked):

```json
{
  "providers": {
    "anthropic": { "apiKey": "...", "baseURL": "...", "model": "claude-sonnet-4-5" },
    "zhipu": { "apiKey": "...", "baseURL": "...", "model": "glm-4.7" }
  },
  "model": "glm-4.7@zhipu",
  "compressionThreshold": 0.8,
  "thinking": true,
  "thinkingTokens": 20000
}
```

Model specifier: `model@provider`. Priority: CLI arg > MODEL env var > config.

## Sessions

Stored in `~/.minicode/sessions/<project-hash>/`. Per-project isolation based on cwd hash. Auto-save after each exchange. Supports compression at configurable token threshold.

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

Register in `src/agent.ts` constructor tools Map and export from `src/tools/index.ts`.

## TUI Styling

Messages render via `src/components/Message.tsx`:
- User: dim color background
- Assistant: plain white text
- Tool call: yellow (e.g., `Bash(ls -la)`)
- Tool result: dim color
- System: gray prefix `[System]`
- Error: red prefix `[Error]`

No emoji used. No brackets around tool calls.
