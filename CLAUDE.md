# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
npm run dev          # Development mode via tsx (TUI)
npm run build        # TypeScript compile to dist/
npm run start        # Run built TUI from dist/
npm run start "prompt"  # Run with initial prompt
```

No test framework or linter is configured.

## Architecture

A minimal coding agent with **ink-based TUI**, tool use, and session persistence. All interaction happens through the TUI — there is no separate console mode.

### Source Layout

- `src/cli.tsx` — CLI entry point. Parses args, loads config, renders `App` from `tui.tsx`
- `src/cli/tui.tsx` — ink React app with `App` component, multi-agent hooks, TUI state management
- `src/agent.ts` — Core `Agent` class. Owns the conversation loop, delegates to services
- `src/config.ts` — Provider-based model config from `~/.minicode/config.json`. Model specifier format: `model@provider`
- `src/llm/anthropic.ts` — Thin wrapper around `@anthropic-ai/sdk`. Handles chat with tools and optional extended thinking
- `src/tools/` — Tool implementations (`read`, `write`, `edit`, `bash`, `agent`) + `ToolRegistry`
- `src/services/` — Cross-cutting services (`TokenManager`, `CompressionService`, `AgentRegistry`)
- `src/cli/commands/` — `CommandRegistry` (`index.ts`) and builtin command registrations (`builtin.ts`)
- `src/utils/` — Display adapters, session persistence, session-to-display conversion
- `src/components/Message.tsx` — Single React component rendering messages by role

### Core Loop (`Agent.run()`)

1. Push user message, then loop: send messages + tool defs to LLM
2. Stream response: text streams to TUI, thinking streams dimmed, tool_use blocks collected
3. Create display slot per tool call (shows formatted call), execute all tools in parallel via `Promise.allSettled()`
4. Update slots with combined call+result, push tool results as user messages, repeat until no tool calls
5. Track tokens via `TokenManager`, auto-compress when exceeding threshold ratio
6. Auto-save session after each complete exchange

### Key Patterns

**Registry pattern** — Both tools and TUI commands use a `Map<string, T>` registry with `register()`/`get()`/`getAll()`. Tools are registered in `Agent` constructor; commands are registered in `commands/builtin.ts` module scope.

**Display adapter** — `DisplayAdapter` interface abstracts output with slot-based tool display. `CallbackDisplay` fires React state callbacks for TUI. `ConsoleDisplay` writes to stdout as fallback. Tools get their own display slot via `createSlot()`/`updateSlot()` for real-time updates. The agent only calls display methods — it never touches React state directly.

**Multi-agent coordination** — `AgentRegistry` manages main + sub-agents (IDs "1"–"9"). Sub-agents are spawned via the `agent` tool, which is only registered when an `AgentRegistry` is provided and not in `excludeTools`. Each agent session tracks status, messages, and optional summary.

**Service injection** — `Agent` constructor accepts optional `TokenManager`, `CompressionService`, and `AgentRegistry` overrides (defaults to `*Impl` classes). This enables testing without real API calls.

**Session display bridge** — `SessionDisplayImpl` converts raw `SessionData` (Anthropic message format) into `DisplayMessage[]` for TUI rendering, handling the mismatch between tool_use blocks and display roles.

### Config Format

`~/.minicode/config.json` (not tracked):

```json
{
  "providers": {
    "anthropic": { "apiKey": "...", "baseURL": "...", "models": { "claude-sonnet-4-5": {} } },
    "zhipu": {
      "apiKey": "...",
      "baseURL": "...",
      "models": {
        "glm-4.7": { "contextLength": 128000 },
        "glm-5.1": { "contextLength": 200000 }
      }
    }
  },
  "model": "glm-5.1@zhipu",
  "compressionThreshold": 0.8,
  "thinking": true,
  "thinkingTokens": 20000,
  "promptFile": "MINICODE.md"
}
```

`AgentConfig.excludeTools` (string[]) prevents specific tools from being registered in an agent instance.

Priority: CLI `--model` arg > `MODEL` env var > config `model` field.

### Adding a Tool

1. Create file in `src/tools/` exporting a `ToolDef` (interface defined in `src/tools/index.ts`):

```typescript
export const myTool: ToolDef = {
  name: string,
  description: string,
  input_schema: Record<string, unknown>,
  format?: (args) => React.ReactElement,    // Display element, e.g. <Text>Bash(ls -la)</Text>
  execute: (args, context?) => Promise<ToolResult>  // ToolResult = { output: string, display: React.ReactElement }
};
```

2. Register in `Agent` constructor: `this.toolRegistry.register(myTool)`
3. Export from `src/tools/index.ts`

The `ToolExecutionContext` provides `registry` (AgentRegistry), `config` (AgentConfig), `currentAgentId`, and `display` (ToolDisplayHandle for real-time slot updates).

### TUI Commands

Handled by `CommandRegistry` in `src/cli/commands/`. Each command gets a `CommandContext` with agent, session manager, and React state setters. Two command types: `handler` (manipulates app state directly) or `prompt` (returns text injected into conversation). To add a command: call `commandRegistry.register({ name, description, handler | prompt })` in `builtin.ts`.

### TUI Styling

`Message` component renders by role: user=white on gray background, assistant=default terminal color, thinking=dim (truncated to 200 chars), tool=yellow (uses tool-provided React element if available), tool_result=dim (uses tool-provided element if available), system=dim, error=red. Streaming shows inverse cursor block. No emoji.

### Sessions

Stored as JSON in `~/.minicode/sessions/<project-hash>/` (MD5 of cwd, 12 chars). Include messages + token count. Auto-saved after each exchange.

### Feature Coupling Matrix

Adding a new feature? Check which existing features it must integrate with. Each `×` marks a direct dependency — changes in either side affect the other.

| Feature | Agent Loop | Tool System | ESC Abort | Multi-Agent | Session | Compression | TUI Display | Commands | Config |
|---------|:----------:|:-----------:|:---------:|:-----------:|:-------:|:-----------:|:-----------:|:--------:|:------:|
| Agent Loop | — | × | × | × | × | × | × | | × |
| Tool System | × | — | × | × | × | | × | | × |
| ESC Abort | × | × | — | × | × | | × | | |
| Multi-Agent | × | × | × | — | | | × | | × |
| Session | × | × | × | | — | × | × | × | |
| Compression | × | | | | × | — | × | × | × |
| TUI Display | × | × | × | × | × | × | — | × | × |
| Commands | × | × | | × | × | × | × | — | |
| Config | × | × | | × | | × | × | | — |

**Key integration points (what to touch when adding a feature):**

- **Tool System** — `ToolExecutionContext` in `src/tools/index.ts`: add new fields here if the feature needs to pass data to tools. Every tool receives this context.
- **Agent Loop** — `Agent.run()` in `src/agent.ts`: the central `while` loop. New lifecycle hooks (pre-stream, post-tool, etc.) go here.
- **TUI Display** — `DisplayAdapter` in `src/utils/display.ts`: add methods for new UI events. `CallbackDisplay` in `tui.tsx` implements them as React state updates.
- **Session** — `SessionData` format in `src/utils/session.ts`: new persistent state needs serialization here + conversion in `SessionDisplayImpl`.
- **Commands** — register in `src/cli/commands/builtin.ts`. `CommandContext` in `index.ts` may need new fields for features that commands must orchestrate.
- **Abort** — `Agent.abort()` in `src/agent.ts`: new blocking operations need `AbortSignal` awareness. Pass signal through `ToolExecutionContext.signal` for tools, or check `throwIfAborted()` at loop boundaries.
