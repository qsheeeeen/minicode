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
		modelOverride string
		sessionName   string
		resumeRecent  bool
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
		}
	}

	resolved, err := internal.ResolveConfig(modelOverride)
	if err != nil || resolved.Model.APIKey == "" {
		fmt.Fprintln(os.Stderr, "Error: No valid model configuration found")
		os.Exit(1)
	}

	cfg := internal.AgentConfig{
		APIKey:                    resolved.Model.APIKey,
		BaseURL:                   resolved.Model.BaseURL,
		Model:                     resolved.Model.Model,
		ContextLength:             resolved.Model.ContextLength,
		CompressionThresholdRatio: resolved.CompressionThreshold,
		ProjectPromptFile:         resolved.PromptFile,
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

	// Permission service
	permSvc := internal.NewPermissionService(internal.PermissionMode(resolved.PermissionMode))
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

	// Interactive TUI mode
	registry := internal.NewAgentRegistry(ag)
	if err := internal.RunTUI(ag, registry, cmdReg); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}

func registerAllTools(ag *internal.Agent, cfg internal.AgentConfig, skills *internal.SkillRegistry) {
	ag.ToolRegistry().Register(internal.NewReadTool())
	ag.ToolRegistry().Register(internal.NewWriteTool())
	ag.ToolRegistry().Register(internal.NewEditTool())
	ag.ToolRegistry().Register(internal.NewBashTool())
	ag.ToolRegistry().Register(internal.NewSubAgentTool(cfg))
	ag.ToolRegistry().Register(internal.NewActivateSkillTool(skills))
	ag.ToolRegistry().Register(internal.NewAskUserTool(nil))
	ag.ToolRegistry().Register(internal.NewSetModelTool(nil))
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
			case "--model", "-m", "--session", "-s":
				i++ // skip value
			case "--resume", "--version", "-v":
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
