package skills

func init() {
	RegisterBuiltin(`---
name: skill-creator
description: "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations."
---
# Skill Creator

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.

## About Skills
Skills are modular, self-contained packages that extend the agent's capabilities. They use a "progressive disclosure" model to keep the agent's context footprint small, only loading full instructions when a specific skill is activated.

## Structure
Every skill consists of a required ` + "`SKILL.md`" + ` file:
- **Frontmatter** (YAML): Contains ` + "`name`" + ` and ` + "`description`" + ` fields. This is used for discovery.
- **Body** (Markdown): Instructions and guidance for using the skill.

## Steps
1. Create a directory for the skill (e.g., ` + "`~/.minicode/skills/my-skill`" + `).
2. Add a ` + "`SKILL.md`" + ` file in that directory.
3. Write the frontmatter with ` + "`name`" + ` and ` + "`description`" + `.
4. Write the body with clear, concise instructions for the agent to follow.`)

	RegisterBuiltin(`---
name: init
description: "Set up a minimal AGENTS.md for this repo with codebase exploration and optional skills."
---
Set up a minimal AGENTS.md (and optionally skills) for this repo. AGENTS.md is loaded into every agent session, so it must be concise — only include what the agent would get wrong without it.

## Phase 0: Check for an existing AGENTS.md

Before asking anything, check if AGENTS.md already exists at the project root. This determines the next step.

**If AGENTS.md already exists**, ask the user whether to review/improve it, leave it and set up skills, or start fresh.

**If no AGENTS.md exists**, ask if they want to set up a project AGENTS.md, skills, or both.

## Phase 1: Explore the codebase

Survey key files to understand the project: manifest files (package.json, Cargo.toml, etc.), README, build configs, CI config, existing AI coding tool configs (AGENTS.md, .cursor/rules, .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules).

Detect:
- Build, test, and lint commands (especially non-standard ones)
- Languages, frameworks, and package manager
- Project structure
- Code style rules that differ from language defaults
- Non-obvious gotchas, required env vars, or workflow quirks
- Existing skills directory

## Phase 2: Fill in the gaps

Ask the user only what the code can't answer: non-obvious commands, gotchas, conventions, testing quirks. Skip things already in README or obvious from manifest files.

## Phase 3: Propose and get approval

Present a short proposal listing what will be set up, then get user approval before writing anything.

## Phase 4: Write AGENTS.md

Write a minimal AGENTS.md at the project root. Every line must pass: "Would removing this cause the agent to make mistakes?" If no, cut it.

Include:
- Build/test/lint commands the agent can't guess
- Code style rules that differ from language defaults
- Testing instructions and quirks
- Repo etiquette (branch naming, commit style)
- Required env vars or setup steps
- Non-obvious gotchas or architectural decisions

Exclude:
- File-by-file structure (agent can discover by reading the codebase)
- Standard language conventions the agent already knows
- Generic advice ("write clean code", "handle errors")
- Commands obvious from manifest files

## Phase 5: Suggest and create skills

Skills add capabilities the agent can use on demand without bloating every session. Suggest skills when you find:
- Repeatable workflows (verify changes, deploy, release process)
- Reference knowledge for specific subsystems

Create each skill in the configured skills directory (default: ` + "`.minicode/skills/<skill-name>/SKILL.md`" + `):

` + "```" + `yaml
---
name: <skill-name>
description: <what the skill does and when to use it>
---

<Instructions for agent>
` + "```" + `

## Phase 6: Summary

Recap what was set up and remind the user they can run /init again anytime to refine.`)
}
