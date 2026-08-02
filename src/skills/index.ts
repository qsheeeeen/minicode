import fs from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
  dirPath?: string;
}

/**
 * SkillRegistry — an explicit, injectable registry of skills. Owned by the
 * composition root (one per app) instead of a process-global map, so tests
 * and multiple app instances never share state.
 */
export class SkillRegistry {
  private skills = new Map<string, SkillMeta>();

  register(meta: SkillMeta): void {
    this.skills.set(meta.name, meta);
  }

  getAvailable(): Pick<SkillMeta, "name" | "description">[] {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  getBody(name: string): string | undefined {
    return this.skills.get(name)?.body;
  }

  clear(): void {
    this.skills.clear();
  }

  /** Scan a directory (each subdir with SKILL.md) and register found skills. */
  async loadDirectory(skillsDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDirPath = path.join(skillsDir, entry.name);
          const skillFilePath = path.join(skillDirPath, "SKILL.md");

          try {
            const content = await fs.readFile(skillFilePath, "utf-8");
            const meta = parseSkillFile(content, skillDirPath);
            if (meta) {
              this.skills.set(meta.name, meta);
            }
          } catch {
            // Ignore if SKILL.md is missing or unreadable
          }
        }
      }
    } catch {
      // Ignore if skills directory doesn't exist
    }
  }
}

/** Register the built-in skills (called explicitly by the composition root). */
export function registerBuiltinSkills(registry: SkillRegistry): void {
  registry.register(skillCreator);
  registry.register(initSkill);
}

export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registerBuiltinSkills(registry);
  return registry;
}

function parseSkillFile(content: string, dirPath: string): SkillMeta | null {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)/);
  if (!match) return null;

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    return null;
  }

  if (typeof frontmatter !== "object" || frontmatter === null) return null;

  const fm = frontmatter as Record<string, unknown>;
  const name = typeof fm.name === "string" ? fm.name.trim() : undefined;
  const description =
    typeof fm.description === "string" ? fm.description.trim() : undefined;

  if (!name || !description) return null;

  return {
    name,
    description,
    body: match[2].trim(),
    dirPath,
  };
}

const promptFile = "AGENTS.md";

const skillCreator: SkillMeta = {
  name: "skill-creator",
  description:
    "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations.",
  body: `# Skill Creator

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.

## About Skills
Skills are modular, self-contained packages that extend the agent's capabilities. They use a "progressive disclosure" model to keep the agent's context footprint small, only loading full instructions when a specific skill is activated.

## Structure
Every skill consists of a required \`SKILL.md\` file:
- **Frontmatter** (YAML): Contains \`name\` and \`description\` fields. This is used for discovery.
- **Body** (Markdown): Instructions and guidance for using the skill.

## Steps
1. Create a directory for the skill (e.g., \`.agents/skills/my-skill\`).
2. Add a \`SKILL.md\` file in that directory.
3. Write the frontmatter with \`name\` and \`description\`.
4. Write the body with clear, concise instructions for the agent to follow.`,
};

const initSkill: SkillMeta = {
  name: "init",
  description: `Set up a minimal ${promptFile} for this repo with codebase exploration and optional skills.`,
  body: `Set up a minimal ${promptFile} (and optionally skills) for this repo. ${promptFile} is loaded into every agent session, so it must be concise — only include what the agent would get wrong without it.

## Phase 0: Check for an existing ${promptFile}

Before asking anything, check if ${promptFile} already exists at the project root. This determines the next step.

**If ${promptFile} already exists**, ask the user whether to review/improve it, leave it and set up skills, or start fresh.

**If no ${promptFile} exists**, ask if they want to set up a project ${promptFile}, skills, or both.

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

## Phase 4: Write ${promptFile}

Write a minimal ${promptFile} at the project root. Every line must pass: "Would removing this cause the agent to make mistakes?" If no, cut it.

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

Create each skill in the \`.agents/skills/<skill-name>/SKILL.md\` directory:

\`\`\`yaml
---
name: <skill-name>
description: <what the skill does and when to use it>
---

<Instructions for agent>
\`\`\`

## Phase 6: Summary

Recap what was set up and remind the user they can run /init again anytime to refine.`,
};
