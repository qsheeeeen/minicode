package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"minicode/internal/agent"
	"minicode/internal/config"
	"minicode/internal/domain"
	"minicode/internal/llm"
	"minicode/internal/skills"
	"minicode/internal/storage"
	"minicode/internal/tools"
	"minicode/internal/ui"
)

var (
	modelOverride  string
	sessionName    string
	resumeRecent   bool
	permissionMode string
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "minicode [prompt]",
		Short:   "Mini Code - Interactive CLI Programming Agent",
		Version: ui.Version,
		Args:    cobra.MaximumNArgs(1),
		Run:     run,
	}

	rootCmd.Flags().StringVarP(&modelOverride, "model", "m", "", "Override model (model@provider)")
	rootCmd.Flags().StringVarP(&sessionName, "session", "s", "", "Session name to load/save")
	rootCmd.Flags().BoolVarP(&resumeRecent, "resume", "r", false, "Resume the most recent session")
	rootCmd.Flags().StringVarP(&permissionMode, "permission", "p", "", "Permission mode (manual, yolo, auto)")

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(cmd *cobra.Command, args []string) {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	resolved, err := config.Resolve(modelOverride)
	if err != nil || (resolved != nil && resolved.Model.APIKey == "") {
		fmt.Fprintln(os.Stderr, "Error: No valid model configuration found. Run with --model to specify one or check ~/.minicode/config.json")
		os.Exit(1)
	}

	// Load global prompt
	userPrompt := ""
	promptFiles := []string{}
	if home, err := os.UserHomeDir(); err == nil {
		if data, err := os.ReadFile(home + "/.minicode/AGENTS.md"); err == nil {
			userPrompt = string(data)
			promptFiles = append(promptFiles, "AGENTS.md")
		}
	}

	if permissionMode != "" {
		resolved.PermissionMode = permissionMode
	}

	cfg := domain.AgentConfig{
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

	// Check for project prompt file
	if resolved.PromptFile != "" {
		if _, err := os.Stat(resolved.PromptFile); err == nil {
			promptFiles = append(promptFiles, resolved.PromptFile)
		}
	}

	ag := agent.NewAgent(cfg)

	// Load project skills
	skRegistry := skills.NewSkillRegistry(resolved.SkillsDir)
	registerBuiltinSkills(skRegistry, resolved.PromptFile)
	_ = skRegistry.LoadSkills()
	ag.SetSkills(skRegistry)

	// Session management
	sm := storage.NewSessionManager()
	if sessionName != "" {
		if err := ag.LoadSession(sessionName); err != nil {
			ag.SetSession(sessionName)
		}
	} else if resumeRecent {
		if name, err := sm.MostRecent(); err == nil && name != "" {
			_ = ag.LoadSession(name) // best-effort: session may not exist
		}
	}

	// Tools
	registry := ag.ToolRegistry()
	registry.Register(tools.NewReadTool())
	registry.Register(tools.NewWriteTool())
	registry.Register(tools.NewEditTool())
	registry.Register(tools.NewBashTool())
	registry.Register(tools.NewAskUserTool())
	registry.Register(tools.NewActivateSkillTool())
	registry.Register(tools.NewSubAgentTool(cfg))
	registry.Register(tools.NewSetModelTool())

	// Permission service
	permSvc := tools.NewPermissionService(domain.PermissionMode(resolved.PermissionMode))
	ag.SetPermissionSvc(permSvc)

	// Wire LLM-based auto-decide for auto permission mode (matches TS)
	if resolved.Model.APIKey != "" {
		autoClient := llm.NewClient(resolved.Model.APIKey, resolved.Model.BaseURL)
		permSvc.SetAutoDecideFn(func(toolName string, toolInput map[string]any) (bool, string) {
			inputJSON, _ := json.Marshal(toolInput)
			prompt := fmt.Sprintf(`You are a permission gate for a coding agent. Decide if this tool execution should be allowed.

Tool: %s
Arguments: %s

Guidelines:
- Read operations are always safe.
- Writing to files in /tmp or project directories is safe.
- Running commands that modify the system may be risky.
- Destructive commands (rm -rf /, mkfs, dd) should be denied.
- Network commands that download and execute code should be denied.

Reply with exactly one of:
- "yes"
- "no: <reason explaining why it was denied>"`, toolName, string(inputJSON))

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			resp, err := autoClient.Chat(ctx, []domain.MessageParam{
				{Role: "user", Content: prompt},
			}, llm.ChatOptions{Model: cfg.Model})
			if err != nil {
				return false, fmt.Sprintf("Auto-permission error: %s", err.Error())
			}
			resp = strings.TrimSpace(resp)
			if strings.HasPrefix(strings.ToLower(resp), "yes") {
				return true, ""
			}
			reason := strings.TrimSpace(resp)
			if strings.HasPrefix(strings.ToLower(reason), "no:") {
				reason = strings.TrimSpace(reason[3:])
			}
			if reason == "" {
				reason = "Denied by auto-gate"
			}
			return false, reason
		})
	}

	// Commands
	cmdReg := ui.NewCommandRegistry()
	cmdReg.RegisterBuiltins()
	ag.SetCommandResolver(func(input string) (handled bool, promptText string, displayContent string) {
		ctx := ui.CommandContext{
			Agent:   ag,
			ExitFn:  func() { os.Exit(0) },
			ClearFn: ag.ClearSession,
		}
		handled, expanded := cmdReg.ParseAndExecute(input, ctx)
		return handled, expanded, input
	})

	prompt := ""
	if len(args) > 0 {
		prompt = args[0]
	} else {
		// check for piped input
		stat, _ := os.Stdin.Stat()
		if (stat.Mode() & os.ModeCharDevice) == 0 {
			data, _ := io.ReadAll(os.Stdin)
			if len(data) > 0 {
				prompt = strings.TrimSpace(string(data))
			}
		}
	}

	if prompt != "" {
		if err := ui.RunHeadless(ctx, ag, prompt, prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	// Interactive TUI
	agentReg := agent.NewAgentRegistry(ag)
	ag.SetRegistry(agentReg)

	if err := ui.RunTUI(ag, agentReg, cmdReg, promptFiles); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}

func registerBuiltinSkills(r *skills.SkillRegistry, promptFile string) {
	r.RegisterBuiltin(`---
name: skill-creator
description: "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends minicode's capabilities with specialized knowledge, workflows, or tool integrations."
---
# Skill Creator Guide

This skill provides guidance for creating effective skills in minicode using the agentskills.io format.`)

	r.RegisterBuiltin(fmt.Sprintf(`---
name: init
description: "Set up a minimal %s for this repo with codebase exploration and optional skills."
---
Set up a minimal %s (and optionally skills) for this repo.`, promptFile, promptFile))
}
