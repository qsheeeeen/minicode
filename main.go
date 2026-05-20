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
	cfg := internal.AgentConfig{
		Model:                     getEnv("MODEL", "claude-sonnet-4-5"),
		APIKey:                    getEnv("ANTHROPIC_API_KEY", ""),
		BaseURL:                   getEnv("ANTHROPIC_BASE_URL", ""),
		ContextLength:             200000,
		CompressionThresholdRatio: 0.8,
		ProjectPromptFile:         "AGENTS.md",
	}

	if cfg.APIKey == "" {
		fmt.Fprintln(os.Stderr, "Error: ANTHROPIC_API_KEY environment variable is required")
		os.Exit(1)
	}

	ag := internal.NewAgent(cfg)
	registerAllTools(ag.ToolRegistry())

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	prompt := getPrompt()
	if prompt != "" {
		// Headless mode: run and exit
		if err := internal.RunHeadless(ctx, ag, prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	// Interactive mode placeholder (TUI comes in M4)
	fmt.Printf("minicode [Go] — model: %s, session: %s\n", ag.Model(), ag.SessionName())
	fmt.Println("(interactive TUI coming in M4)")

	<-ctx.Done()
	fmt.Println("\nGoodbye.")
}

func registerAllTools(r *internal.ToolRegistry) {
	r.Register(internal.NewReadTool())
	r.Register(internal.NewWriteTool())
	r.Register(internal.NewEditTool())
	r.Register(internal.NewBashTool())
}

func getPrompt() string {
	args := os.Args[1:]

	// Filter out flags, collect positional arguments
	var positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if len(a) > 0 && a[0] == '-' {
			if a == "--model" || a == "-m" || a == "--session" || a == "-s" {
				i++ // skip next arg (the value)
			}
			continue
		}
		positional = append(positional, a)
	}

	if len(positional) > 0 {
		return positional[0]
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

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
