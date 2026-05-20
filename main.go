// minicode — an interactive CLI coding agent.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"minicode/internal/agent"
	"minicode/internal/tools"
)

func main() {
	cfg := agent.Config{
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

	ag := agent.New(cfg)

	// Register built-in tools
	registerAllTools(ag.ToolRegistry())

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// For now, just print startup info — headless mode comes in M3
	fmt.Printf("minicode [Go] — model: %s, session: %s\n", ag.Model(), ag.SessionName())
	fmt.Println("(headless mode coming in M3)")

	<-ctx.Done()
	fmt.Println("\nGoodbye.")
}

func registerAllTools(r *tools.Registry) {
	r.Register(tools.NewReadTool())
	r.Register(tools.NewWriteTool())
	r.Register(tools.NewEditTool())
	r.Register(tools.NewBashTool())
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
