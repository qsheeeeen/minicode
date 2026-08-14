# AGENTS.md

Guidance for the CLI agent working in this repository.

## Build & Run

```bash
bun run dev           # Dev (Bun native TS/TSX)
bun run build         # tsc → dist/
bun run typecheck     # tsc --noEmit
bun test              # Vitest watch
bun run test:run      # Tests once
bunx vitest run src/foo.test.ts   # Single file (bunx, not npx)
bun run format        # Prettier on src/
```

Headless mode (non-TUI; for scripting and verification):
```bash
bun run src/main.ts -H "<prompt>"
bun run src/main.ts -H --perm yolo "<prompt>"   # with permission mode
```

## Config

`~/.minicode/config.json`. Model specifier is `model@provider` (e.g. `claude-sonnet-4-5@anthropic`); resolution: CLI `-m` > `MODEL` env > config `model`. Tiers `"pro"`/`"flash"` each map to a `model@provider`. Providers support arbitrary keys — any `model@provider` resolves via `createClient()` protocol registry or falls back to Anthropic-compatible. See `config.example.json`.

Tests must not depend on real config files — mock or inject.

## Verification

After any feature/fix, self-test in headless mode — it surfaces bugs the TUI doesn't:
```bash
bun run src/main.ts -H "<prompt exercising the change>"
```

## Conventions

- Node16 ESM, `.js` extensions on relative imports, TS strict, JSX via `react-jsx` (Ink v7 + React 19).
- Tests colocated (`foo.ts` → `foo.test.ts`), Vitest + `ink-testing-library`. Mock with `vi.spyOn`/`vi.fn`/`vi.mock`; TUI tests use `render()` / `lastFrame()` / `stdin.write()`.
- **No real LLM/API in tests** — use `VirtualLLMClient` (`llm/virtual.ts`) + `createVirtualTool` (`testing.ts`); see `agent.virtual.test.ts`.
- External skills in `.agents/skills/` (gitignored except itself); built-ins (`skill-creator`, `init`) in `src/skills/`.

## TUI Demos

Standalone harnesses in a real terminal — cover what `ink-testing-library` can't (colors, layout, transitions). Shared `fixtures.ts`.

```bash
bun run src/ui/tui/demos/widgets/<name>.tsx   # one component (L1)
bun run src/ui/tui/demos/scenes/<name>.tsx     # scripted flow (L3)
bun run src/ui/tui/demos/composite.tsx         # all widgets (L2)
```

New component → add a `widgets/<name>.tsx`. New cross-component flow → add a `scenes/<name>.tsx` that scripts it end-to-end.

## Architecture

Forced by root constraints, not convention. Before adding code or a module, confirm it satisfies them — don't just put it "where it's currently used."

**Root constraints:**
1. LLM / file / shell / terminal are **uncontrollable side effects** — expensive, non-deterministic, irreversible, vendor-specific.
2. The **conversation (blocks) is the core asset**, produced by the agent, consumed by the UI.
3. **Tests must not depend on a real LLM/API.**
4. **New tools / commands / protocols / strategies must be addable without touching existing ones.**

**Derived principles:**
- Push the uncontrollable behind a boundary; keep core logic pure (unit-testable, injectable).
- Policy (orchestration) vs. mechanism (swappable implementations); one-way deps.
- `LLMContext` blocks are the **single source of truth**; derived views (tokens / display / stats / journal) compute or subscribe — never a second copy.
- Cross-cutting concerns (persistence, tokens, change-tracking, permission, prompts) are narrow-interface services, each with state where it belongs.
- Declaration (`registry`) vs. execution (`executor`) for extensible things.
- **Errors are values, not control flow** — two failure classes, no third: step failures (tool denial, validation, rollback conflict) return as values (`ToolRunResult`, `ok:false` results); turn failures (abort, fatal IO, LLM fault) throw only `TurnFaultError` (`core/results.ts`) and are caught exactly once at the turn boundary. Vendor exceptions never cross the LLM port — they arrive as `{ok:false, fault}` stream terminal values.

**Dependency direction (a violation is a bug):**
```
main → app → agent → (tools, services, llm)
ui → (agent, services)
llm / tools never import ui
utils depends on nothing but stdlib
```

`app/` is the only composition root that knows concrete implementations — pure wiring onto `AgentDeps`/`AppRuntime` abstractions, no logic. `agent.ts` is pure policy: the loop order (fetch blocks → ask LLM → run tools → write blocks → repeat), reaching everything via `deps`/`context`. `ui/` is an observer + input router — it never calls back into the agent, and display overrides live on the renderer, not on `LLMUserBlock`.

## Implementation Discipline

Don't stop at "it works." While implementing a change:

- **Duplicate edits are a smell.** If the change forces the same logic in N places, consolidate to one source of truth as part of the change — don't just propagate the edit.
- **Survey coupled code now**, while context is loaded: conflicts to resolve, things to merge, refactors that fall out. Do it now, not later.
- **Pick the most elegant implementation**, not the first that runs.

Feature work is the best moment to refactor — you understand the code most deeply right then, and deferred cleanup compounds into debt.
