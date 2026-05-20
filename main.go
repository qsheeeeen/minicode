package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
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

	fmt.Printf("minicode [Go] — model: %s, session: %s\n", ag.Model(), ag.SessionName())
	fmt.Println("(headless mode coming in M3)")

	<-ctx.Done()
	fmt.Println("\nGoodbye.")
}

func registerAllTools(r *internal.ToolRegistry) {
	r.Register(internal.NewReadTool())
	r.Register(internal.NewWriteTool())
	r.Register(internal.NewEditTool())
	r.Register(internal.NewBashTool())
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
