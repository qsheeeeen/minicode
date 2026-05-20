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

func main() {
	// Resolve model from CLI arg, env var, or config file
	modelOverride := ""
	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		if (args[i] == "--model" || args[i] == "-m") && i+1 < len(args) {
			modelOverride = args[i+1]
			i++
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
	registerAllTools(ag, cfg)

	// Set up permission service
	permSvc := internal.NewPermissionService(internal.PermissionMode(resolved.PermissionMode))
	_ = permSvc

	// Set up command registry
	cmdReg := internal.NewCommandRegistry()
	internal.RegisterBuiltinCommands(cmdReg)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	prompt := getPrompt(args)
	if prompt != "" {
		// Check if it's a slash command in headless
		cmdCtx := internal.CommandContext{
			Agent:   ag,
			ExitFn:  func() { os.Exit(0) },
			ClearFn: ag.ClearSession,
		}
		if handled, expanded := cmdReg.ParseAndExecute(prompt, cmdCtx); handled {
			if expanded != "" {
				prompt = expanded
			} else {
				// Handler command executed directly (e.g. /exit)
				return
			}
		}

		if err := internal.RunHeadless(ctx, ag, prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	// Interactive mode (TUI in M4)
	fmt.Printf("minicode [Go] — model: %s\n", ag.Model())
	fmt.Println("(interactive TUI coming in M4)")

	<-ctx.Done()
	fmt.Println("\nGoodbye.")
}

func registerAllTools(ag *internal.Agent, cfg internal.AgentConfig) {
	ag.ToolRegistry().Register(internal.NewReadTool())
	ag.ToolRegistry().Register(internal.NewWriteTool())
	ag.ToolRegistry().Register(internal.NewEditTool())
	ag.ToolRegistry().Register(internal.NewBashTool())
	ag.ToolRegistry().Register(internal.NewAgentTool(cfg))
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
			if a == "--model" || a == "-m" || a == "--session" || a == "-s" {
				i++
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
