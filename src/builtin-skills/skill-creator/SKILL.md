---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations.
---
# Skill Creator

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.

## About Skills
Skills are modular, self-contained packages that extend the agent's capabilities. They use a "progressive disclosure" model to keep the agent's context footprint small, only loading full instructions when a specific skill is activated.

## Structure
Every skill consists of a required \`SKILL.md\` file:
- **Frontmatter** (YAML): Contains \`name\` and \`description\` fields. This is used for discovery.
- **Body** (Markdown): Instructions and guidance for using the skill.

## Steps
1. Create a directory for the skill (e.g., \`~/.minicode/skills/my-skill\`).
2. Add a \`SKILL.md\` file in that directory.
3. Write the frontmatter with \`name\` and \`description\`.
4. Write the body with clear, concise instructions for the agent to follow.
