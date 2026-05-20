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
