# AGENTS.md

This file provides guidance to the CLI agent when working with code in this repository.

## Overview

minicode is an LLM-powered CLI coding agent with React/Ink TUI. TypeScript implementation in `src/` is the sole codebase.

## Build & Run

```bash
bun run dev           # Development mode (Bun native TS/TSX)
bun run build         # tsc → dist/
bun run start         # Run compiled output
bun run typecheck     # tsc --noEmit (type check only)
bun test              # Vitest in watch mode
bun run test:run      # Run tests once
bunx vitest run src/agent.test.ts  # Single test file (use bunx, not npx)
```

**Headless mode** (non-TUI, for scripting and verification):
```bash
bun run src/cli.tsx -H "<prompt>"           # Basic headless
bun run src/cli.tsx -H --perm yolo "<prompt>" # Headless with permission mode
```

## Architecture

```
src/
├── cli.tsx               # Entry point: arg parsing, config loading, TUI/headless branching
├── agent.ts              # Core Agent class with LLM loop (stream → tools → repeat)
├── messages.ts           # MessageStore: two-layer messages (LLM + Display), session persistence
├── config.ts             # Multi-provider config loader (~/.minicode/config.json)
├── args.ts               # CLI argument parser
├── llm/anthropic.ts      # Anthropic SDK wrapper (chat + chatStream)
├── services/
│   ├── agent-registry.ts # Multi-agent session tracking (main + sub-agents 2-9)
│   ├── token-manager.ts  # Token counting, compression threshold tracking
│   ├── compression-service.ts  # LLM-based context compression (keeps last 10 turns)
│   ├── permission.ts     # manual/yolo/auto permission modes
│   ├── bash.ts           # Synchronous execSync wrapper for slash commands
│   ├── change-journal.ts # JSONL change tracking (before-state per file edit/write)
│   ├── rollback-executor.ts # Conversation + file rollback using change journal
│   └── session-stats.ts  # Per-model token usage tracking, receipt data
├── tools/
│   ├── registry.ts       # ToolDef interface, self-registering pattern via register()
│   ├── index.ts          # Barrel: imports all tool modules to trigger registration
│   ├── bash.ts           # child_process.spawn with streaming
│   ├── read.ts / write.ts / edit.ts / grep.ts
│   ├── sub_agent.ts      # Spawns child Agent with restricted tool set
│   ├── activate_skill.ts / ask_user.ts / set_model.ts
├── skills/index.ts       # Loads SKILL.md from skills directories (built-in + external)
├── ui/
│   ├── tui.tsx           # Root <App> component, Ink render
│   ├── headless.ts       # Non-interactive stdout renderer
│   ├── routing.ts        # Input router: slash commands / bash escapes / agent
│   ├── commands/index.ts # Slash command registry (handler vs prompt types)
│   └── tui/              # React components: store.tsx (useReducer+Context), inputs, Header, etc.
└── utils/
    ├── logger.ts         # Pino session-scoped logging
    ├── prompts.ts        # Global + project AGENTS.md loading
    ├── display.ts        # AgentEvents + UserPrompter interfaces
    └── diff.ts           # Unified diff generation for Edit tool
```

### Core Flow

1. `cli.tsx` loads config, skills, creates Agent → branches to TUI (`render(<App>)`) or headless (`runHeadless()`)
2. Input routed through `routeInput()`: slash command → `executeCommand()`, `!` prefix → `runBash()`, else → `agent.run()`
3. `Agent.run()` enters loop: `AnthropicClient.chatStream()` → accumulate blocks in MessageStore → execute tool calls → repeat
4. `MessageStore.onChange()` → TUI dispatches to Redux-like store; headless renders to stdout
5. `TokenManager` tracks usage; auto-triggers `CompressionService` when exceeding threshold ratio

### Key Concepts

**Two-layer messages:** `MessageParam[]` (raw API format, with `_display` metadata stripped by `toLLMMessages()`) and `DisplayMessage[]` (flat discriminated union for UI, including UI-only `StatusMessage[]`). Session persisted as JSONL at `~/.minicode/sessions/<md5-hash>/<name>.context.jsonl`.

**Self-registering tools:** Each tool file calls `register(toolDef)` at module scope. `tools/index.ts` imports all to trigger registration. `ToolDef` has `execute()`, `requiresPermission`, `readOnly`, `interactive` flags. Sub-agents get filtered set: only read-only + non-interactive tools.

**Permission modes:** `manual` (prompt per call), `yolo` (allow all), `auto` (LLM decides safety). Shift+Tab cycles in TUI.

**Skills:** Progressive disclosure — `getAvailableSkills()` returns name+description only; `getSkillBody()` loads full content on demand when `ActivateSkill` tool runs. Built-in: `skill-creator`, `init`. External: directories with `SKILL.md` (YAML frontmatter + body).

**Undo/rollback:** `/undo` command with two scopes — conversation-only or conversation+files. `ChangeJournal` records before-state of each file edit/write as JSONL. `RollbackExecutor` restores files and truncates conversation to a chosen turn.

## Config

`~/.minicode/config.json` — model specifier format: `model@provider` (e.g., `claude-sonnet-4-5@anthropic`). Resolution order: CLI `-m` > `MODEL` env > config `model` field. Supports tiers: `"pro"` and `"flash"`, each mapping to a `model@provider`.

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
