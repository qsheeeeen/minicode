# AGENTS.md

## Project Structure

Slash commands: `src/commands/index.ts` — `handler` type for system commands, `prompt` type injects text into conversation

Builtin slash commands:
- `/exit` — Exit the application
- `/clear` — Clear all history and start a new session
- `/compress` — Compress conversation history
- `/effort` — Set thinking effort (low|medium|high|xhigh|max)
- `/new [name]` — Create a new session (with optional name)
- `/rename <name>` — Rename current session
- `/resume [name]` — Load a session (without args: list sessions)
- `/plan` — Turn discussion into an executable plan (prompt type)
- `/test` — Run a smoke test of available tools (prompt type)
- `/skills` — List available skills
- `/model` — Switch model/provider via UI
- Plans: auto-generated to `.claude/plans/` after `/plan` command
- Project skills: `config.skillsDir` (default: `.minicode/skills`) — agentSkills.io format (directory with `SKILL.md`)

Builtin skills (registered in `src/skills/index.ts`):
- `/init` — Set up AGENTS.md and project skills
- `/skill-creator` — Guide for creating effective skills

## Build & Run Commands

```bash
npm run dev           # Development mode via tsx (no build needed, hot reload)
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled version from dist/ (node, not tsx)
```

**tsx dev mode gotcha:** Uses tsx for fast dev with ESM, but behaves slightly differently than compiled Node.js. Some native modules or CJS interop may differ.

## Testing

```bash
npm test          # Run Vitest in watch mode
npm run test:run  # Run tests once
npm run test:run -- --coverage  # With coverage
```

Test files are co-located with source: `src/**/*.test.ts`.

## CLI

```bash
minicode                          # Start TUI with new session
minicode "list files"             # Start with initial prompt
minicode --model glm-4.7@zhipu   # Override model
minicode --session my-project     # Use named session
minicode --resume                 # Resume most recent session
minicode -H --perm yolo "ls"     # Headless mode, no permission prompts
```

Model priority: CLI `--model` > `MODEL` env var > config `model` field.

## Config (`~/.minicode/config.json`)

```jsonc
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "baseURL": "https://api.anthropic.com",
      "models": { "claude-sonnet-4-5": { "contextLength": 200000 } }
    }
  },
  "model": "claude-sonnet-4-5@anthropic",   // model@provider
  "compressionThreshold": 0.8,               // 0-1, compress at this ratio
  "thinking": false,                         // extended thinking
  "effort": "medium",                        // reasoning effort level
  "promptFile": "AGENTS.md", // project prompt filename
  "permissionMode": "manual",                // manual | yolo | auto
  "skillsDir": ".minicode/skills"            // project skills directory
}
```

When adding or modifying config options, always update `config.example.json` (at project root, in sync with `src/config.ts`).

## Architecture

```
src/
├── cli.tsx                  # CLI entry point — renders App, parses args, starts TUI/headless (tsx dev mode)
├── tui.tsx                  # Top-level TUI App component + hooks
├── headless.ts              # Headless (non-TUI) mode runner
├── args.ts                  # CLI argument parsing (yargs)
├── agent.ts                 # Agent class with tool execution loop
├── messages.ts              # MessageStore (API + display message model)
├── config.ts                # Multi-provider config loader
├── tui/
│   ├── Message.tsx          # Message display component by role
│   ├── MessageList.tsx      # Scrollable message list
│   ├── Header.tsx           # App header with model/session info
│   ├── StatusBar.tsx        # Bottom status bar with token usage
│   ├── ModalPrompter.tsx    # Modal input prompts
│   ├── InputArea.tsx        # Main input area with mode switching
│   ├── inputs.tsx           # Input component variants (modal, inline, password)
│   └── tool-display.tsx     # Tool call/result rendering
├── commands/
│   └── index.ts             # CommandRegistry class + builtin slash commands
├── skills/
│   └── index.ts             # SkillRegistry class + builtin skills
├── llm/
│   └── anthropic.ts         # AnthropicClient — streaming + non-streaming
├── services/
│   ├── agent-registry.ts    # Multi-agent coordination
│   ├── permission.ts        # PermissionService (manual/yolo/auto)
│   ├── token-manager.ts     # Token tracking + compression triggers
│   ├── compression-service.ts  # LLM-based conversation summarization
│   └── index.ts             # Re-exports
├── tools/
│   ├── index.ts             # ToolDef interface + registerTools helper
│   ├── registry.ts          # ToolRegistry (register/get/getAll)
│   ├── read.ts / write.ts / edit.ts / bash.ts  # Core tools
│   ├── agent.ts             # Sub-agent delegation tool
│   └── activate_skill.ts    # Skill activation tool
└── utils/
    ├── diff.ts              # Unified diff generation
    ├── display.ts           # DisplayAdapter + CallbackDisplay + ConsoleDisplay
    ├── prompts.ts           # Global (~/.minicode/AGENTS.md) and project prompt loading
    ├── session.ts           # SessionManager (v1/v2 persistence) — module singleton
    ├── session-display.ts   # Legacy v1 session → display message conversion
    └── logger.ts            # pino-based session-scoped logging
```

### Core Flow

1. User input → Agent adds message to `MessageStore`, sends `store.toLLMMessages()` to LLM
2. LLM responds with text + tool_use blocks (streamed to TUI via `CallbackDisplay` or stdout in headless mode)
3. Text/thinking streams incrementally; tool_use blocks are added to store; tools execute sequentially
4. Tool results are pushed as a single user turn with `tool_result` blocks
5. Store changes fire `onChange` → TUI re-renders from `store.toDisplayMessages()`
6. Session auto-saved (v2 format) after each exchange
7. Token usage tracked; progress bar in status bar; auto-compresses when exceeding threshold
8. Sub-agents spawned via `agent` tool, managed by `AgentRegistry`; switch with Ctrl+O

### Key Concepts

**Two message layers:**
- `MessageParam[]` — raw API format for the LLM (stored in `MessageStore.getTurns()`)
- `DisplayMessage[]` — UI format with React elements (generated by `MessageStore.toDisplayMessages()`)
- `_display` field on user `MessageParam` stores user-facing text separately from LLM-facing text (e.g., for slash command expansion)

**Permission system** (`src/services/permission.ts`):
- Three modes: `manual` (prompt per tool), `yolo` (allow all), `auto` (LLM decides)
- `PermissionService.check()` called before each tool execution
- Shift+Tab in TUI cycles mode; `--permission` flag for headless

**Skill system:**
- Skills follow agentSkills.io format: directory with `SKILL.md` (YAML frontmatter + markdown body)
- `SkillRegistry` loads skills from `skillsDir` config path, parses frontmatter for name/description
- Available skills listed in system prompt; `ActivateSkill` tool loads full instructions into context
- Builtin skills defined in `src/cli/skills/builtin.ts`; project skills from `.claude/skills/`
- Project prompt file (`AGENTS.md` by default) is loaded into context alongside system prompt

**Display adapters:**
- `CallbackDisplay` — for TUI (hooks into React state via callbacks)
- `ConsoleDisplay` — fallback/headless (log to stdout)
- `RecordDisplay` — for testing (records events)

**Headless mode** (`--headless`):
- No TUI, output to stdout with incremental streaming
- Confirm always denies unless `--permission yolo` or `auto`
- Handles session resume, abort, and error display

### Adding a Tool

Create a file in `src/tools/` implementing `ToolDef`:
```typescript
export const myTool: ToolDef = {
  name: 'my_tool',
  description: 'What it does',
  input_schema: { /* JSON Schema */ },
  requiresPermission: true,    // optional: gate behind PermissionService
  formatCall: (args) => <Text>MyTool(...)</Text>,       // display in TUI
  formatResult: (output, input) => <Text>done</Text>,   // display result
  execute: async (args, context) => {
    // context.registry — AgentRegistry for sub-agent access
    // context.config — parent AgentConfig
    // context.skillRegistry — skill access
    return { output: 'result for LLM', display: <Text dimColor>done</Text> };
  }
};
```
Then add to the `registerTools()` call in `src/tools/index.ts`.

## Note

- Read the code to understand the structure. Allow large refactors to implement the best solution from scratch.
- When adding or modifying config options, always update `config.example.json` with the corresponding example.
