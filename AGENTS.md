# AGENTS.md

This file provides guidance to the CLI agent when working with code in this repository.

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
bun run src/main.ts -H "<prompt>"           # Basic headless
bun run src/main.ts -H --perm yolo "<prompt>" # Headless with permission mode
```

## Config

Default config location: `~/.minicode/config.json`.

Model specifier format: `model@provider` (e.g., `claude-sonnet-4-5@anthropic`, `deepseek-chat@deepseek`). Resolution order: CLI `-m` > `MODEL` env > config `model` field. Supports tiers: `"pro"` and `"flash"`, each mapping to a `model@provider`.

Providers config supports arbitrary keys — any `model@provider` resolves via `createClient()` protocol registry or falls back to Anthropic-compatible (e.g., `deepseek-chat@deepseek` with a custom `baseURL`). See `config.example.json` for a concrete provider/tier setup.

**Testing:** Tests must not depend on real config files. Mock or inject config in tests.

## Verification Protocol

After implementing any feature or fix, self-test in headless mode:

```bash
bun run src/main.ts -H "<prompt that exercises the change>"
```

Headless mode exposes bugs that TUI doesn't. Always verify output is correct.

## Implementation Discipline

Don't stop at "it works." While implementing a change:

1. **Editing the same logic in several places is a smell.** If the change forces duplicate edits, consolidate it (single source of truth) as part of the change — don't just propagate the edit across call sites.
2. **Survey coupled code while the context is loaded:** conflicts to resolve, things to merge, a local refactor that falls out. Do it now, not later.
3. **Pick the most elegant implementation**, not the first one that runs.

Feature work is the best moment to refactor — you understand the code most deeply right then, and deferred cleanup compounds into debt. (Example: adding a "no output" hint to `ShellService` surfaced that `runSync` and `formatResult` each held formatting logic — the right move was to route `runSync` through `formatResult`, which also fixed `runSync` losing the exit code on non-zero exits.)

## Testing Patterns

- Tests use Vitest with `ink-testing-library` for TUI components
- Test files colocated with source: `foo.ts` → `foo.test.ts`
- Mock patterns: `vi.spyOn()`, `vi.fn()`, module mocking with `vi.mock()`
- TUI component tests: render with `render()`, query with `lastFrame()`, simulate input with `stdin.write()`
- Demo components in `src/ui/tui/demos/` for visual testing during development
- **Virtual LLM testing:** `new VirtualLLMClient(responses)` (from `llm/virtual.ts`) + `createVirtualTool(name, handler)` (from `testing.ts`) enable testing Agent's tool loop without real API calls. See `agent.virtual.test.ts` for examples.

## Skills Directory

External skills live in `.agents/skills/` (gitignored except this directory). Each skill is a directory with a `SKILL.md` file containing YAML frontmatter + body. Built-in skills (`skill-creator`, `init`) are in `src/skills/`.

## Module Design (first principles)

The architecture is forced by a few root constraints, not by convention. Before adding code or a new module, confirm it satisfies these — don't just put it "where it's currently used."

**Root constraints:**
1. **LLM / file / shell / terminal are uncontrollable side effects** — expensive, non-deterministic, irreversible, vendor-specific.
2. **The conversation (blocks) is the core asset**, produced by the agent and consumed by the UI.
3. **Tests must not depend on a real LLM/API.**
4. **New tools / commands / protocols / strategies must be addable without touching existing ones.**

**Principles derived from them:**
- **Push the uncontrollable behind a boundary.** Side effects (LLM, IO, shell, rendering) live in boundary modules with swappable implementations; core logic stays pure (unit-testable, injectable).
- **Policy vs. mechanism, one-way deps.** Orchestration (`agent`) is policy — it states *what/when*; mechanisms (`LLMClient`, `ToolExecutor`, UI) are interchangeable implementations. Policy depends on abstractions.
- **Single source of truth, append-only.** `LLMContext`'s blocks are the conversation truth; derived views (tokens / display / stats / journal) compute or subscribe from it — never a second copy.
- **Cross-cutting concerns become narrow-interface services.** Persistence, tokens, change-tracking, permission, prompts are not the agent's job — each is a single-responsibility service.
- **Declaration vs. execution split.** Extensible things (tools, commands, protocols, strategies) separate the descriptor (`registry`) from the imperative handler (`executor`) — adding one doesn't modify the other.
- **Errors are values, not control flow.** Tool denial/failure is a business outcome, returned as `ToolRunResult`, never thrown across a boundary; only genuinely unexpected failures (abort, IO crash) throw.

**How each layer is designed (derived from the above):**

- **Entry (`main`/`args`/`config`/`messages`)** — parse the uncontrollable outside (CLI, disk) into deterministic data and stop. No runtime state, no business decisions. `messages` is just a type barrel.
- **`app/` (composition root)** — the *only* place allowed to know concrete implementations: bind protocol/UI/services onto the `AgentDeps`/`AppRuntime` abstractions. Everything else depends on abstractions. Pure wiring, no logic.
- **`agent.ts` (orchestration = policy)** — only the loop order (fetch blocks → ask LLM → run tools → write blocks → repeat), reaching everything via `deps`/`context`. It must not know how the LLM is implemented, how a tool runs, or how the UI paints. Inject doubles → the whole loop is unit-testable.
- **`llm/` (boundary)** — hide the most uncontrollable side effect. `client` is the abstraction, `protocols` are swappable, `context` is the vendor-neutral append-only block stream (pure data). Blocks are protocol data — *no* UI intent (display overrides, extra fields) may grow onto `LLMUserBlock`.
- **`tools/` (declaration vs. execution)** — `registry` holds declarative `ToolDef`s; `executor` is the cross-cutting handler (permission, batching, result flushing). Adding a tool touches only `builtin/`. **Outcomes return as `ToolRunResult`; denial/failure never throws across the boundary.**
- **`services/` (cross-cutting, one concern per file)** — each stateful/side-effecting concern is its own service behind a narrow interface. State lives where it belongs: session state in `session-manager`, blocks in `LLMContext`, file changes in `change-journal` — never duplicated across. `permission` decides only (enforcement is `ToolExecutor`); `context-manager` watches tokens but stores no blocks; `session-persistence` is pure IO.
- **`ui/` (observer + input router)** — only reads blocks to render and routes input in; it never participates in agent policy. Rendering splits "pure transform" (`display`) from "side-effect boundary" (`renderer`/`timeline`). **Never calls back into the agent; display is purely a UI concern (overrides live on the renderer, not on `LLMUserBlock`).** `routing` classifies input, `route-handler` acts — judgment and action stay separate.
- **`skills` / `testing` / `utils`** — `utils` is stateless, side-effect-free, and depends on no domain layer (or cycles form); `testing` provides `VirtualLLMClient`/`createVirtualTool` so constraint #3 holds; `skills` is a hot-loadable extension point (declarative, registered as commands).

Dependency direction (a violation is a bug): `main → app → agent → (tools, services, llm)`; `ui → (agent, services)`; `llm`/`tools` never import `ui`; `utils` depends on nothing but the standard library.

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

## SOLID Principles

- **Single Responsibility Principle (SRP):** Each module/class/function should have only one reason to change.
- **Open/Closed Principle (OCP):** Software entities should be open for extension, closed for modification.
- **Liskov Substitution Principle (LSP):** Subtypes must be substitutable for their base types without altering program correctness.
- **Interface Segregation Principle (ISP):** Clients should not be forced to depend on interfaces th
ey don't use.
- **Dependency Inversion Principle (DIP):** High-level modules should not depend on low-level modules; both should depend on abstractions.
