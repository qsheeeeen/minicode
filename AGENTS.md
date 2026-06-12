# AGENTS.md

This file provides guidance to the CLI agent when working with code in this repository.

## Overview

minicode is an LLM-powered CLI coding agent with a React/Ink TUI. The TypeScript implementation in `src/` is the sole codebase. The project goal is self-bootstrapping: use minicode to develop minicode itself.

## Build & Run

```bash
bun run dev           # Development mode (Bun native TS/TSX)
bun run build         # tsc → dist/
bun run start         # Run compiled output
bun run typecheck     # tsc --noEmit (type check only)
bun test              # Vitest in watch mode
bun run test:run      # Run tests once
bunx vitest run src/agent.test.ts  # Single test file (use bunx, not npx)
bun run format        # Prettier formatting on src/
```

**Headless mode** (non-TUI, for scripting and verification):
```bash
bun run src/cli.tsx -H "<prompt>"           # Basic headless
bun run src/cli.tsx -H --perm yolo "<prompt>" # Headless with permission mode
```

## Slash Commands

Commands entered at the TUI prompt:

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

**Permission mode:** Shift+Tab cycles between manual/yolo/auto.

## Architecture

```
src/
├── cli.tsx                 # Entry point: arg parsing, config loading, TUI/headless branching
├── agent.ts                # Core Agent class with LLM loop (stream → tools → repeat)
├── agent.virtual.test.ts   # Full agent-loop tests using VirtualLLMClient
├── args.ts                 # CLI argument parser
├── config.ts               # Multi-provider config loader (~/.minicode/config.json)
├── messages.ts             # MessageStore: two-layer messages (LLM + Display), session persistence
├── llm-context.ts          # LLM context message types and helpers
├── llm-context-manager.ts  # Context window / truncation manager
├── testing.ts              # Shared test helpers (createVirtualTool)
├── llm/
│   ├── client.ts           # LLMClient interface, LLMStream (AsyncGenerator), protocol registry
│   ├── anthropic.ts        # Anthropic SDK adapter
│   ├── openai-chat.ts      # OpenAI Chat Completions adapter
│   ├── openai-responses.ts # OpenAI Responses API adapter
│   ├── virtual.ts          # Virtual LLM client for testing (scripted responses)
│   └── index.ts            # Barrel exports
├── services/
│   ├── agent-registry.ts   # Multi-agent session tracking (main + sub-agents 2-9)
│   ├── token-tracker.ts    # Token counting via Signal<number>, compression threshold tracking
│   ├── compression-service.ts   # LLM-based context compression (keeps last 10 turns)
│   ├── context-manager.ts  # Context assembly and routing
│   ├── session-manager.ts  # Session metadata and listing
│   ├── session-persistence.ts   # JSONL read/write for session files
│   ├── session-lifecycle.ts     # Session switching helper (switchSession)
│   ├── session-stats.ts    # Per-model token usage tracking, receipt data
│   ├── prompt-manager.ts   # System prompt assembly
│   ├── permission.ts       # manual/yolo/auto permission modes
│   ├── shell.ts            # Synchronous execSync wrapper for slash commands
│   ├── change-journal.ts   # JSONL change tracking (before-state per file edit/write)
│   ├── rollback-executor.ts     # Conversation + file rollback using change journal
│   └── index.ts            # Service barrel exports
├── tools/
│   ├── registry.ts         # ToolDef interface, self-registering pattern via register()
│   ├── index.ts            # Barrel: imports all builtin tools to trigger registration
│   ├── executor.ts         # Tool execution orchestration
│   └── builtin/            # Individual tool implementations
│       ├── read.ts / write.ts / edit.ts / grep.ts
│       ├── shell.ts        # child_process.spawn with streaming
│       ├── sub-agent.ts    # Spawns child Agent with restricted tool set
│       ├── ask-user.ts / load-skill.ts / set-model.ts
│       └── index.ts        # Builtin tool barrel
├── skills/
│   ├── index.ts            # Loads SKILL.md from skills directories (built-in + external)
│   └── skill-manager.ts    # Skill runtime management
├── ui/
│   ├── tui.tsx             # Root <App> component, Ink render
│   ├── headless.ts         # Non-interactive stdout renderer
│   ├── routing.ts          # Input router: slash commands / shell escapes / agent
│   ├── route-handler.ts    # Per-route dispatch implementation
│   ├── commands/index.ts   # Slash command registry (handler vs prompt types)
│   └── tui/
│       ├── store.tsx            # Zustand store wrapping tuiReducer
│       ├── connect-agent.ts     # Agent→Zustand bridge
│       ├── Header.tsx / InputArea.tsx / Message.tsx / MessageList.tsx
│       ├── Help.tsx / Panel.tsx / Receipt.tsx / Status.tsx / SubAgentBar.tsx
│       ├── ModalPrompter.tsx / inputs.tsx / tool-display.tsx
│       └── demos/               # Visual testing components
└── utils/
    ├── logger.ts           # Pino session-scoped logging
    ├── signal.ts           # Signal<T> — minimal reactive value container (get/set/subscribe)
    ├── prompts.ts          # Global + project AGENTS.md loading
    ├── display.ts          # UserPrompter interface + Prompt types
    ├── diff.ts             # Unified diff generation for Edit tool
    └── tool-format.ts      # callContent() for tool call display formatting
```

### Core Flow

1. `cli.tsx` loads config, skills, creates Agent → branches to TUI (`render(<App>)`) or headless (`runHeadless()`)
2. Input routed through `routeInput()`: slash command → `executeCommand()`, `!` prefix → `runShell()`, else → `agent.run()`
3. `Agent.run()` enters loop: `client.chatStream()` → accumulate `StreamEvent` via AsyncGenerator → execute tool calls → repeat
4. `connectAgent()` bridges Agent observables (Signal, MessageStore) to Zustand store; TUI components read via Zustand selectors
5. `TokenTracker` tracks usage via `Signal<number>`; auto-triggers `CompressionService` when exceeding threshold ratio

### Key Concepts

**Signal reactive primitive:** `Signal<T>` (`src/utils/signal.ts`) is a minimal reactive container with `get()`, `set()`, `subscribe()`. Replaces the old AgentEvents system. Agent exposes `tokenCount$: Signal<number>`. TUI subscribes through `connect-agent.ts`.

**Zustand + connect-agent bridge:** TUI state lives in a Zustand store (`store.tsx`) that wraps a `tuiReducer`. `connectAgent()` wires Agent-domain observables to Zustand dispatches — components are pure views reading via selectors. No React Context.

**Multi-provider LLM:** `LLMClient` interface with protocol registry in `client.ts`. Registered protocols: `anthropic`, `openai` (Chat Completions), `openai-responses` (Responses API). Unknown protocols fall back to Anthropic-compatible. `createClient(protocol, apiKey, baseURL)` factory. `LLMStream` is `AsyncGenerator<StreamEvent, LLMResponse, unknown>` — providers return real async generators, not wrapper objects.

**Agent dependency injection:** Agent constructor accepts optional `client?: LLMClient` and `tools?: Map<string, ToolDef>`. Combined with `VirtualLLMClient` (from `llm/virtual.ts`) and `createVirtualTool()` (from `testing.ts`), this enables full agent loop testing without real LLM calls.

**Two-layer messages:** `MessageParam[]` (raw API format, with `_display` metadata stripped by `toLLMMessages()`) and `DisplayMessage[]` (flat discriminated union for UI, including UI-only `StatusMessage[]`). Session persisted as JSONL at `~/.minicode/sessions/<md5-hash>/<name>.context.jsonl`.

**Self-registering tools:** Each tool file calls `register(toolDef)` at module scope. `tools/index.ts` imports all builtin tools to trigger registration. `ToolDef` has `execute()`, `requiresPermission`, `readOnly`, `interactive`, `trackChanges`, `changeOp` fields. Sub-agents get filtered set: only read-only + non-interactive tools.

**Permission modes:** `manual` (prompt per call), `yolo` (allow all), `auto` (LLM decides safety). Shift+Tab cycles in TUI.

**Skills:** Progressive disclosure — `getAvailableSkills()` returns name+description only; `getSkillBody()` loads full content on demand when `LoadSkill` tool runs. Built-in: `skill-creator`, `init`. External: directories with `SKILL.md` (YAML frontmatter + body).

**Undo/rollback:** `/undo` command with two scopes — conversation-only or conversation+files. `ChangeJournal` records before-state of each file edit/write as JSONL. `RollbackExecutor` restores files and truncates conversation to a chosen turn.

### Adding a Tool

Create a file in `src/tools/builtin/` implementing `ToolDef` from `tools/registry.ts`:

```typescript
import { register } from '../registry.js';
import type { ToolDef } from '../registry.js';

const myTool: ToolDef = {
  name: 'my_tool',
  description: 'What it does',
  input_schema: { /* JSON Schema */ },
  requiresPermission: true,    // optional: gate behind PermissionService
  readOnly: false,
  execute: async (args, context) => {
    // context.registry — AgentRegistry for sub-agent access
    // context.config   — parent AgentConfig
    return { output: 'result for LLM' };
  }
};

register(myTool);
```

`tools/index.ts` already imports `tools/builtin/index.ts`, which re-exports all builtin modules to trigger registration.

### Multi-Agent

- Main agent delegates tasks via the `agent` tool; sub-agents run in parallel.
- Switch between main and sub-agent views with **Ctrl+O**.
- Sub-agents receive only read-only, non-interactive tools.

## Config

`~/.minicode/config.json` — model specifier format: `model@provider` (e.g., `claude-sonnet-4-5@anthropic`, `deepseek-chat@deepseek`). Resolution order: CLI `-m` > `MODEL` env > config `model` field. Supports tiers: `"pro"` and `"flash"`, each mapping to a `model@provider`.

Providers config supports arbitrary keys — any `model@provider` resolves via `createClient()` protocol registry or falls back to Anthropic-compatible (e.g., `deepseek-chat@deepseek` with a custom `baseURL`). See `config.example.json` for a concrete provider/tier setup.

## Verification Protocol

After implementing any feature or fix, self-test in headless mode:

```bash
bun run src/cli.tsx -H "<prompt that exercises the change>"
```

Headless mode exposes bugs that TUI doesn't. Always verify output is correct.

## Testing Patterns

- Tests use Vitest with `ink-testing-library` for TUI components
- Test files colocated with source: `foo.ts` → `foo.test.ts`
- Mock patterns: `vi.spyOn()`, `vi.fn()`, module mocking with `vi.mock()`
- TUI component tests: render with `render()`, query with `lastFrame()`, simulate input with `stdin.write()`
- Demo components in `src/ui/tui/demos/` for visual testing during development
- **Virtual LLM testing:** `new VirtualLLMClient(responses)` (from `llm/virtual.ts`) + `createVirtualTool(name, handler)` (from `testing.ts`) enable testing Agent's tool loop without real API calls. See `agent.virtual.test.ts` for examples.

## Skills Directory

External skills live in `.agent/skills/` (gitignored except this directory). Each skill is a directory with a `SKILL.md` file containing YAML frontmatter + body. Built-in skills (`skill-creator`, `init`) are in `src/skills/`.

## Module Convention

- All imports use `.js` extensions with relative paths (Node16 ESM resolution)
- Pure ESM (`"type": "module"`), no CommonJS
- JSX via `react-jsx` automatic runtime (Ink v7 + React 19)
- TypeScript strict mode enabled

## TUI Development

Demo components in `src/ui/tui/demos/` render individual TUI components in isolation. Run them with:
```bash
bun run src/ui/tui/demos/index.tsx
```
Useful for visual testing when modifying UI components.
