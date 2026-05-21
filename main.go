package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"minicode/internal"
)

const version = "0.1.0 (Go)"

func main() {
	args := os.Args[1:]

	// Handle --version / -v early
	for _, a := range args {
		if a == "--version" || a == "-v" {
			fmt.Printf("minicode v%s\n", version)
			return
		}
	}

	// Parse flags
	var (
		modelOverride  string
		sessionName    string
		resumeRecent   bool
		headlessExplicit bool
		permissionMode string
	)
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--model", "-m":
			if i+1 < len(args) {
				modelOverride = args[i+1]
				i++
			}
		case "--session", "-s":
			if i+1 < len(args) {
				sessionName = args[i+1]
				i++
			}
		case "--resume":
			resumeRecent = true
		case "--headless", "-H":
			headlessExplicit = true
		case "--permission", "--perm":
			if i+1 < len(args) {
				permissionMode = args[i+1]
				i++
			}
		}
	}

	resolved, err := internal.ResolveConfig(modelOverride)
	if err != nil || resolved.Model.APIKey == "" {
		fmt.Fprintln(os.Stderr, "Error: No valid model configuration found")
		os.Exit(1)
	}

	// Load global prompt from ~/.minicode/AGENTS.md
	userPrompt := ""
	if home, err := os.UserHomeDir(); err == nil {
		if data, err := os.ReadFile(home + "/.minicode/AGENTS.md"); err == nil {
			userPrompt = string(data)
		}
	}

	cfg := internal.AgentConfig{
		APIKey:                    resolved.Model.APIKey,
		BaseURL:                   resolved.Model.BaseURL,
		Model:                     resolved.Model.Model,
		ContextLength:             resolved.Model.ContextLength,
		CompressionThresholdRatio: resolved.CompressionThreshold,
		ThinkingEnabled:           resolved.Thinking.Enabled,
		ThinkingBudget:            resolved.Thinking.BudgetTokens,
		Effort:                    resolved.Thinking.Effort,
		ProjectPromptFile:         resolved.PromptFile,
		UserPrompt:                userPrompt,
	}

	ag := internal.NewAgent(cfg)

	// Handle session resume
	sm := internal.NewSessionManager()
	if sessionName != "" {
		if data, err := sm.Get(sessionName); err == nil && data != nil {
			_ = ag.LoadSession(sessionName)
		} else {
			ag.SetSession(sessionName)
		}
	} else if resumeRecent {
		if name, err := sm.MostRecent(); err == nil && name != "" {
			_ = ag.LoadSession(name)
		}
	}

	// Load project skills
	skills := internal.NewSkillRegistry(resolved.SkillsDir)
	skills.RegisterBuiltin(`---
name: skill-creator
description: "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations."
---
# Skill Creator Guide

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.

## About Skills
Skills are modular, self-contained packages that extend the agent's capabilities. They use a "progressive disclosure" model to keep the agent's context footprint small, only loading full instructions when a specific skill is activated.

## Structure
Every skill consists of a required SKILL.md file:
- Frontmatter (YAML): Contains name and description fields. This is used for discovery.
- Body (Markdown): Instructions and guidance for using the skill.

## Steps
1. Create a directory for the skill (e.g., ~/.minicode/skills/my-skill).
2. Add a SKILL.md file in that directory.
3. Write the frontmatter with name and description.
4. Write the body with clear, concise instructions for the agent to follow.`)

	skills.RegisterBuiltin(fmt.Sprintf(`---
name: init
description: "Set up a minimal %s for this repo with codebase exploration and optional skills."
---
Set up a minimal %s (and optionally skills) for this repo. %s is loaded into every agent session, so it must be concise — only include what the agent would get wrong without it.

## Phase 0: Check for an existing %s
Before asking anything, check if %s already exists at the project root. This determines the next step.

## Phase 1: Explore the codebase
Detect: Build, test, lint commands, Project structure, Code style rules, Non-obvious gotchas.

## Phase 2: Fill in the gaps
Ask user for info not in code.

## Phase 3: Propose and get approval
## Phase 4: Write %s
## Phase 5: Suggest and create skills
## Phase 6: Summary`, resolved.PromptFile, resolved.PromptFile, resolved.PromptFile, resolved.PromptFile, resolved.PromptFile, resolved.PromptFile))

	_ = skills.LoadSkills()
	ag.SetSkills(skills)

	// Set up command registry
	cmdReg := internal.NewCommandRegistry()
	internal.RegisterBuiltinCommands(cmdReg)

	// Load global skills and register as slash commands
	home, _ := os.UserHomeDir()
	globalSkills := internal.NewSkillRegistry(home + "/.minicode/skills")
	_ = globalSkills.LoadSkills()
	for _, sk := range globalSkills.List() {
		name := sk.Name
		desc := sk.Description
		body := globalSkills.GetBody(name)
		if body != "" {
			cmdReg.Register(&internal.Command{
				Name: name, Description: desc, Kind: internal.CmdPrompt,
				Prompt: func(args []string) string {
					return "<activated_skill name=\"" + name + "\">\n<instructions>\n" + body + "\n</instructions>\n</activated_skill>"
				},
			})
		}
	}
	for _, sk := range skills.List() {
		name := sk.Name
		desc := sk.Description
		body := skills.GetBody(name)
		if body != "" {
			if _, exists := cmdReg.Get(name); exists {
				continue
			}
			cmdReg.Register(&internal.Command{
				Name: name, Description: desc, Kind: internal.CmdPrompt,
				Prompt: func(args []string) string {
					return "<activated_skill name=\"" + name + "\">\n<instructions>\n" + body + "\n</instructions>\n</activated_skill>"
				},
			})
		}
	}

	registerAllTools(ag, cfg, skills)

	// Wire command resolver into agent (for TUI slash command support)
	ag.SetCommandResolver(func(input string) (handled bool, promptText string, displayContent string) {
		cmdCtx := internal.CommandContext{
			Agent:   ag,
			ExitFn:  func() { os.Exit(0) },
			ClearFn: ag.ClearSession,
		}
		handled, promptText = cmdReg.ParseAndExecute(input, cmdCtx)
		return handled, promptText, ""
	})

	// Permission service: CLI flag > config > default
	permMode := internal.PermissionMode(resolved.PermissionMode)
	if permissionMode != "" {
		permMode = internal.PermissionMode(permissionMode)
	}
	permSvc := internal.NewPermissionService(permMode)
	ag.SetPermissionSvc(permSvc)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	prompt := getPrompt(args)
	if prompt != "" {
		originalPrompt := prompt
		cmdCtx := internal.CommandContext{
			Agent:   ag,
			ExitFn:  func() { os.Exit(0) },
			ClearFn: ag.ClearSession,
		}
		if handled, expanded := cmdReg.ParseAndExecute(prompt, cmdCtx); handled {
			if expanded != "" {
				prompt = expanded
			} else {
				return
			}
		}

		if err := internal.RunHeadless(ctx, ag, prompt, originalPrompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	// If --headless without prompt, use stdin
	if headlessExplicit {
		fmt.Fprintln(os.Stderr, "Error: --headless requires a prompt argument or piped input")
		os.Exit(1)
	}

	// Interactive TUI mode
	registry := internal.NewAgentRegistry(ag)
	if err := internal.RunTUI(ag, registry, cmdReg); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}

func registerAllTools(ag *internal.Agent, cfg internal.AgentConfig, skills *internal.SkillRegistry) {
	avail := internal.ToolAvailability{
		AgentRegistry: true, // always available
		SkillRegistry: skills != nil,
	}

	allTools := []internal.Tool{
		internal.NewReadTool(),
		internal.NewWriteTool(),
		internal.NewEditTool(),
		internal.NewBashTool(),
		internal.NewSubAgentTool(cfg),
		internal.NewActivateSkillTool(skills),
		internal.NewAskUserTool(nil),
		internal.NewSetModelTool(nil),
	}

	for _, tool := range allTools {
		skip := false
		for _, req := range tool.Requires() {
			switch req {
			case internal.ReqAgentRegistry:
				if !avail.AgentRegistry {
					skip = true
				}
			case internal.ReqSkillRegistry:
				if !avail.SkillRegistry {
					skip = true
				}
			}
		}
		if !skip {
			ag.ToolRegistry().Register(tool)
		}
	}
}

func getPrompt(args []string) string {
	var positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if len(a) > 0 && a[0] == '-' {
			switch a {
			case "--model", "-m", "--session", "-s", "--permission", "--perm":
				i++ // skip value
			case "--resume", "--version", "-v", "--headless", "-H":
				// flags without values
			default:
				// unknown flags — might be passed to the prompt
				positional = append(positional, a)
			}
			continue
		}
		positional = append(positional, a)
	}
	if len(positional) > 0 {
		return strings.Join(positional, " ")
	}
	// Check for piped input
	stat, _ := os.Stdin.Stat()
	if (stat.Mode()&os.ModeCharDevice) == 0 {
		data, _ := io.ReadAll(os.Stdin)
		if len(data) > 0 {
			return strings.TrimSpace(string(data))
		}
	}
	return ""
}
