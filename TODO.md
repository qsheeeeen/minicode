# Completed
- [x] Multi-model config per provider (model@provider format)
- [x] Config moved to ~/.minicode/
- [x] Global prompt (~/.minicode/MINICODE.md)
- [x] Per-project prompt (./MINICODE.md in project root)
- [x] Prompt loading mechanism (src/utils/prompts.ts)
- [x] Agent as tool — sub-agent delegation via `agent` tool + AgentRegistry

# Roadmap

## Autonomous Agent
- [ ] Headless mode — run without TUI, accept task from CLI arg or stdin
- [ ] Task decomposition — break high-level goals into actionable steps
- [ ] Self-validation loop — auto-run tests/lint, fix errors, iterate until green
- [ ] Progress reporting — structured output for external monitoring
- [ ] Retry and recovery — handle API errors, rate limits, and tool failures gracefully

## Feature Enhancements
- [ ] Tool control commands (`/enable tool`, `/disable tool`)
- [ ] `/review` command — invoke another model to review/discuss with current model

## Code Quality
- [ ] Add unit test framework
- [ ] Add ESLint/Prettier config
- [ ] Strict TypeScript mode

## Documentation
- [ ] Improve usage docs
- [ ] Add tool development guide
- [ ] Write self-bootstrapping dev log

## Experimental
- [ ] Skill system — reusable code patterns / skill packs
- [ ] Multi-model parallel calls (voting or task division)
- [ ] Web search tool integration
- [ ] Code execution sandbox

# Bug Tracking
- None currently

# Ideas
- `/diff` command to view conversation change history
- Export sessions as Markdown
- `/teach` mode for users to teach agent new skills
- Session branching (like git branches)
