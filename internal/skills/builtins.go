package skills

func init() {
	RegisterBuiltin(`---
name: skill-creator
description: "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations."
---
# Skill Creator Guide

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.`)

	RegisterBuiltin(`---
name: init
description: "Set up a minimal project instruction file (e.g. GEMINI.md or AGENTS.md) for this repo with codebase exploration and optional skills."
---
Set up a minimal project instruction file (and optionally skills) for this repo.`)
}
