package ui

import (
	"sort"
	"strings"

	"minicode/internal/agent"
)

// CommandKind distinguishes handler commands from prompt-expanding commands.
type CommandKind string

const (
	CmdHandler CommandKind = "handler" // executes immediately, returns no LLM input
	CmdPrompt  CommandKind = "prompt"  // expands to prompt text sent to LLM
)

// Command is a slash command definition.
type Command struct {
	Name        string
	Description string
	Kind        CommandKind
	// Handler is called for handler-type commands.
	Handler func(args []string, ctx CommandContext) bool
	// Prompt expands to text injected into the LLM conversation.
	Prompt func(args []string) string
}

// CommandContext provides commands with access to the application.
type CommandContext struct {
	Agent      *agent.Agent
	ClearFn    func()
	SetModelFn func(modelSpec string)
	ExitFn     func()
}

// CommandRegistry holds registered slash commands.
type CommandRegistry struct {
	commands map[string]*Command
}

// NewCommandRegistry creates an empty command registry.
func NewCommandRegistry() *CommandRegistry {
	return &CommandRegistry{commands: make(map[string]*Command)}
}

// Register adds a command.
func (r *CommandRegistry) Register(cmd *Command) {
	r.commands[cmd.Name] = cmd
}

// Get returns a command by name.
func (r *CommandRegistry) Get(name string) (*Command, bool) {
	cmd, ok := r.commands[name]
	return cmd, ok
}

// List returns all registered commands, sorted by name.
func (r *CommandRegistry) List() []Command {
	var list []Command
	for _, cmd := range r.commands {
		list = append(list, *cmd)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].Name < list[j].Name
	})
	return list
}

// ParseAndExecute parses a command string and runs the handler if found.
// Returns handled=true if the command was executed directly. If promptText is set, it replaces the user input.
func (r *CommandRegistry) ParseAndExecute(input string, ctx CommandContext) (handled bool, promptText string) {
	if len(input) == 0 || input[0] != '/' {
		return false, ""
	}

	parts := strings.SplitN(input[1:], " ", 2)
	name := strings.TrimSpace(parts[0])
	var args []string
	if len(parts) > 1 {
		args = []string{strings.TrimSpace(parts[1])}
	}

	cmd, ok := r.Get(name)
	if !ok {
		return false, ""
	}

	if cmd.Kind == CmdHandler {
		if cmd.Handler != nil {
			cmd.Handler(args, ctx)
		}
		return true, ""
	}

	if cmd.Kind == CmdPrompt && cmd.Prompt != nil {
		return true, cmd.Prompt(args)
	}

	return false, ""
}

// RegisterBuiltins adds the standard set of commands.
func (r *CommandRegistry) RegisterBuiltins() {
	r.Register(&Command{Name: "exit", Description: "Quit the application", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ExitFn != nil {
				ctx.ExitFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "quit", Description: "Quit the application", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ExitFn != nil {
				ctx.ExitFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "clear", Description: "Clear conversation history", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "plan", Description: "Ask for a high-level plan before starting", Kind: CmdPrompt,
		Prompt: func(args []string) string {
			return "I want you to think step-by-step and create a detailed plan before making any changes. Focus on architectural soundness and potential edge cases."
		},
	})
	r.Register(&Command{Name: "test", Description: "Run a smoke test of available tools", Kind: CmdPrompt,
		Prompt: func(args []string) string {
			return "Run a quick smoke test: verify you can use Read, Write, Edit, and Bash tools. Report which ones work."
		},
	})
	r.Register(&Command{Name: "model", Description: "Switch model/provider via UI", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			// Model switching is handled externally (TUI shows model select)
			return true
		},
	})
}
