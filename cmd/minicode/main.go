package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"minicode/internal/agent"
	"minicode/internal/commands"
	"minicode/internal/config"
	"minicode/internal/domain"
	"minicode/internal/llm"
	"minicode/internal/services"
	"minicode/internal/storage"
	"minicode/internal/ui"
	"minicode/internal/ui/tui"
)

var (
	modelOverride  string
	sessionName    string
	resumeRecent   bool
	headless       bool
	permissionMode string
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "minicode [prompt]",
		Short:   "Mini Code - Interactive CLI Programming Agent",
		Version: tui.Version,
		Args:    cobra.MaximumNArgs(1),
		Run:     run,
	}

	rootCmd.Flags().StringVarP(&modelOverride, "model", "m", "", "Override model (model@provider)")
	rootCmd.Flags().StringVarP(&sessionName, "session", "s", "", "Session name to load/save")
	rootCmd.Flags().BoolVarP(&resumeRecent, "resume", "r", false, "Resume the most recent session")
	rootCmd.Flags().BoolVarP(&headless, "headless", "H", false, "Run without TUI, output to stdout")
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

	if permissionMode != "" {
		resolved.PermissionMode = permissionMode
	}

	userPrompt, promptFiles := config.LoadPromptFiles(resolved.PromptFile)

	cfg := domain.AgentConfig{
		APIKey:                    resolved.Model.APIKey,
		BaseURL:                   resolved.Model.BaseURL,
		Model:                     resolved.Model.Model,
		Provider:                  resolved.Model.Provider,
		ContextLength:             resolved.Model.ContextLength,
		CompressionThresholdRatio: resolved.CompressionThreshold,
		ThinkingEnabled:           resolved.Thinking.Enabled,
		ThinkingBudget:            8192,
		Effort:                    resolved.Thinking.Effort,
		ProjectPromptFile:         resolved.PromptFile,
		UserPrompt:                userPrompt,
		SkillsDir:                 resolved.SkillsDir,
	}

	ag := agent.NewAgent(cfg)

	// Session management
	if sessionName != "" {
		if err := ag.LoadSession(sessionName); err != nil {
			ag.SetSession(sessionName)
		}
	} else if resumeRecent {
		sm := storage.NewSessionManager()
		if name, err := sm.MostRecent(); err == nil && name != "" {
			_ = ag.LoadSession(name)
		}
	}

	// Permission service
	permSvc := services.NewPermissionService(domain.PermissionMode(resolved.PermissionMode))
	if resolved.Model.APIKey != "" {
		client := llm.NewClient(resolved.Model.APIKey, resolved.Model.BaseURL)
		permSvc.SetupAutoDecide(client, cfg.Model)
	}
	ag.SetPermissionSvc(permSvc)

	// Command resolver
	cfgObj, _ := config.Load()
	ag.SetCommandResolver(commands.NewResolver(ag, cfgObj))

	// Determine prompt
	prompt := readPrompt(args)

	if headless && prompt == "" {
		fmt.Fprintln(os.Stderr, "Error: --headless requires a prompt argument")
		os.Exit(1)
	}

	if prompt != "" || headless {
		if err := ui.RunHeadless(ctx, ag, prompt, prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	if err := tui.RunTUI(ag, promptFiles); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}

func readPrompt(args []string) string {
	if len(args) > 0 {
		return args[0]
	}
	stat, _ := os.Stdin.Stat()
	if (stat.Mode() & os.ModeCharDevice) == 0 {
		data, _ := io.ReadAll(os.Stdin)
		if len(data) > 0 {
			return strings.TrimSpace(string(data))
		}
	}
	return ""
}
