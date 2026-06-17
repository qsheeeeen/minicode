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

`~/.minicode/config.json` — model specifier format: `model@provider` (e.g., `claude-sonnet-4-5@anthropic`, `deepseek-chat@deepseek`). Resolution order: CLI `-m` > `MODEL` env > config `model` field. Supports tiers: `"pro"` and `"flash"`, each mapping to a `model@provider`.

Providers config supports arbitrary keys — any `model@provider` resolves via `createClient()` protocol registry or falls back to Anthropic-compatible (e.g., `deepseek-chat@deepseek` with a custom `baseURL`). See `config.example.json` for a concrete provider/tier setup.

## Verification Protocol

After implementing any feature or fix, self-test in headless mode:

```bash
bun run src/main.ts -H "<prompt that exercises the change>"
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

External skills live in `.agents/skills/` (gitignored except this directory). Each skill is a directory with a `SKILL.md` file containing YAML frontmatter + body. Built-in skills (`skill-creator`, `init`) are in `src/skills/`.

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
