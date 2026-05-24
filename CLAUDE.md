# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

minicode is an LLM-powered CLI coding agent with TUI. This repo contains both the original **TypeScript** implementation (`src/`) and a **Go** rewrite (`cmd/`, `internal/`) with 100% feature parity. The Go version is the active development target.

## Build & Run (Go)

```bash
go build ./...                          # Build all packages
go build -o minicode-go .               # Build binary (root main.go)
go run ./cmd/minicode                   # Run TUI
go run ./cmd/minicode "prompt"          # Headless mode with prompt
go run ./cmd/minicode -m model@provider # Override model
go run ./cmd/minicode -s my-session     # Named session
go run ./cmd/minicode -r                # Resume recent session
```

## Test & Lint (Go)

```bash
go test ./...                           # All tests
go test ./internal/tools -run TestRead  # Single package, filtered
go test ./... -cover                    # With coverage
go test ./... -v -count=1               # Verbose, no cache
go vet ./...                            # Static analysis
go mod tidy                            # Prune dependencies
```

## Build & Run (TypeScript, reference only)

```bash
npm run dev           # Development mode via tsx
npm run build         # Compile to dist/
npm test              # Vitest in watch mode
npm run test:run      # Run tests once
```

## Architecture (Go)

```
cmd/minicode/main.go          # Cobra CLI entry, config loading, mode branching
internal/
├── domain/domain.go          # Shared types: MessageParam, ContentBlock, DisplayMessage, AgentConfig
├── config/config.go          # Viper-based config loader (~/.minicode/config.json), model resolution
├── llm/anthropic.go          # Anthropic Go SDK wrapper, SSE streaming, event dispatch
├── agent/
│   ├── agent.go              # Core loop: user input → LLM stream → tools → repeat
│   ├── store.go              # MessageStore with RWMutex (two-layer: LLM + Display)
│   ├── token_manager.go      # Token tracking and compression threshold
│   └── agent_registry.go     # Multi-agent coordination (Ctrl+O switching)
├── tools/
│   ├── tools.go              # Tool interface, ToolRegistry (RWMutex), ToolContext
│   ├── permission.go         # manual/yolo/auto permission modes
│   ├── read.go / write.go / edit.go / bash.go
│   ├── agent.go              # SubAgent delegation
│   ├── activate_skill.go / ask_user.go / set_model.go
│   └── *_test.go             # One test file per tool
├── storage/session.go        # Session persistence (~/.minicode/sessions/<md5-hash>/)
├── skills/skills.go          # agentSkills.io loader (directory with SKILL.md)
├── ui/
│   ├── tui.go                # Bubble Tea TUI (textarea, viewport, list, spinner, progress, help)
│   ├── headless.go           # Incremental stdout renderer
│   ├── commands.go           # Re-exports Command/Context/Kind/Registry types from ui/commands/
│   ├── tui_test.go           # TUI integration tests
│   ├── display_test.go       # Display adapter tests
│   └── commands/             # One file per slash command + Registry + tests
```

### Core Flow

1. User input → Agent resolves slash commands via `resolveCommand`, adds to `Store`
2. `Store.ToLLMMessages()` → Anthropic SDK streaming via `llm.Client.ChatStream()`
3. `handleStream()` accumulates `input_json_delta` events into tool_use blocks
4. Tools execute sequentially via `Tool.Execute()`; results pushed as `tool_result` user turn
5. Loop repeats if tools were called; otherwise returns
6. `Store.OnChange()` → TUI via `program.Send(displayChangeMsg{})` or headless via callback
7. Token tracking; auto-compression trigger at threshold

### Key Concepts

**Two-layer messages:** `MessageParam` (LLM API format, in `domain`) and `DisplayMessage` (UI format, in `domain`). `Store.ToLLMMessages()` strips `Display` metadata before API call; `Store.ToDisplayMessages()` produces render-ready messages.

**Permission system:** `tools.PermissionChecker` interface with `Check()`, `Mode()`, `CycleMode()`. Shift+Tab cycles in TUI. Headless defaults to deny.

**Tool interface:** `Tool` requires `Name()`, `Description()`, `InputSchema()`, `Execute(ctx, args, tc)`, `RequiresPermission()`, `Requires()`. Tools use `Requires()` to declare `ReqAgentRegistry`/`ReqSkillRegistry` dependencies.

**Thread safety:** `Store` and `ToolRegistry` use `sync.RWMutex`; read-heavy ops use RLock.

## Config

`~/.minicode/config.json` (shared by TS and Go):

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "sk-...",
      "baseURL": "https://api.deepseek.com/anthropic",
      "models": { "deepseek-v4-pro": { "contextLength": 1000000 } }
    }
  },
  "model": "deepseek-v4-pro@deepseek",
  "tiers": { "1": "claude-sonnet@anthropic" },
  "thinking": { "enabled": true, "budgetTokens": 4096, "effort": "medium" },
  "compressionThreshold": 0.8,
  "promptFile": "AGENTS.md",
  "permissionMode": "manual",
  "skillsDir": ".minicode/skills"
}
```

Model resolution: CLI `-m` > `MODEL` env > config `model` field.

## Logging

Go standard library `log/slog` with `TextHandler` writing to `os.Stderr`. Each `Agent` carries a `*slog.Logger` field (initialized in `NewAgent`, `internal/agent/agent.go:68`). The logger is wired but not yet used in the current code — use `a.logger.Info("msg", "key", val)` for structured log output.

TypeScript reference: `src/utils/logger.ts` uses pino for session-scoped logging.

## TUI Dependencies

Uses 6 Charmbracelet Bubbles components: `textarea`, `viewport`, `spinner`, `progress`, `list`, `help`. Styles via `lipgloss`. The TUI aligns with the TS Ink/React reference for visual layout, keyboard shortcuts, and message rendering.

## Verification Protocol

After implementing any feature or fix, self-test in headless mode before marking complete:

```bash
go run ./cmd/minicode -H "<prompt that exercises the change>"
```

Headless mode exposes bugs that TUI doesn't (e.g., `Store.toLLMMessages()` skipping `tool_call` blocks without assistant text). Always verify output is correct.

## Plan Generation

The `/plan` slash command generates executable plans written to `.claude/plans/` in the project root.

## Naming Conventions

- Package: single word, lowercase (`agent`, `tools`, `domain`)
- File: `snake_case.go` for multi-word (`activate_skill.go`, `agent_registry.go`)
- No `Get` prefix on getters (`Turns()` not `GetTurns()`)
- No `tool_` prefix on files in `tools/` package (package name already provides context)
- Error variables: `Err` prefix (`ErrToolDenied`); error types: `Error` suffix (`ToolDeniedError`)
- Constructor: `New` for single primary type (`NewStore()`), `NewTypeName` for multi-type (`NewReadTool()`)
