# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev           # Run in dev mode via tsx (no build needed)
npm run build         # Compile TypeScript to dist/
npm run start         # Run compiled version from dist/
```

## Testing

```bash
npm test          # Run Vitest in watch mode
npm run test:run  # Run tests once
```

Test files are co-located with source: `src/**/*.test.ts`.

## Note

- Read the code to understand the structure. Allow large refactors to implement the best solution from scratch.
- When adding or modifying config options, always update `config.example.json` with the corresponding example.
- When using `@anthropic-ai/sdk` see API docs: https://platform.claude.com/docs/en/api/messages
