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

	// Register built-in tools (M2 will add real implementations)
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
	// Stub tools — real implementations land in M2
	r.Register(&stubTool{name: "read", desc: "Read a file from the local filesystem"})
	r.Register(&stubTool{name: "write", desc: "Write a file to the local filesystem"})
	r.Register(&stubTool{name: "edit", desc: "Perform exact string replacements in an existing file"})
	r.Register(&stubTool{name: "bash", desc: "Execute a bash command"})
}

// stubTool is a placeholder until real tool implementations arrive in M2.
type stubTool struct {
	name, desc string
}

func (t *stubTool) Name() string                  { return t.name }
func (t *stubTool) Description() string           { return t.desc }
func (t *stubTool) InputSchema() map[string]any   { return map[string]any{} }
func (t *stubTool) RequiresPermission() bool      { return t.name == "bash" || t.name == "write" }
func (t *stubTool) Execute(ctx context.Context, args map[string]any, tc tools.Context) (tools.Result, error) {
	return tools.Result{Output: fmt.Sprintf("[stub] %s called with %v", t.name, args)}, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
