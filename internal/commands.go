package internal

import (
	"fmt"
	"sort"
	"time"
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
	// Returns true if the command was handled.
	Handler func(args []string, ctx CommandContext) bool
	// Prompt expands to text injected into the LLM conversation.
	Prompt func(args []string) string
}

// CommandContext provides commands with access to the application.
type CommandContext struct {
	Agent         *Agent
	ClearFn       func()
	SetModelFn    func(modelSpec string)
	ExitFn        func()
	SetSessionFn  func(name string)
	CompressFn    func()
	SetEffortFn   func(effort string)
	ListSkillsFn  func() []string
	ListSessionsFn func() []SessionInfo
	LoadSessionFn func(name string) error
	RenameSessionFn func(oldName, newName string)
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

// ParseAndExecute checks if input starts with "/" and executes the matching command.
// Returns (handled, promptText) — if handled is true and promptText is empty,
// the command was executed directly. If promptText is set, it replaces the user input.
func (r *CommandRegistry) ParseAndExecute(input string, ctx CommandContext) (handled bool, promptText string) {
	if len(input) == 0 || input[0] != '/' {
		return false, ""
	}

	// Split command name and args
	rest := input[1:]
	var cmdName string
	var argsStr string
	for i := 0; i < len(rest); i++ {
		if rest[i] == ' ' {
			cmdName = rest[:i]
			argsStr = rest[i+1:]
			break
		}
	}
	if cmdName == "" {
		cmdName = rest
	}

	cmd, ok := r.commands[cmdName]
	if !ok {
		return false, ""
	}

	var args []string
	if argsStr != "" {
		args = []string{argsStr}
	}

	switch cmd.Kind {
	case CmdHandler:
		if cmd.Handler != nil {
			return cmd.Handler(args, ctx), ""
		}
	case CmdPrompt:
		if cmd.Prompt != nil {
			return true, cmd.Prompt(args)
		}
	}

	return false, ""
}

// RegisterBuiltinCommands adds the standard slash commands.
func RegisterBuiltinCommands(r *CommandRegistry) {
	r.Register(&Command{Name: "exit", Description: "Exit the application", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ExitFn != nil {
				ctx.ExitFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "clear", Description: "Clear all history and start a new session", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "plan", Description: "Turn discussion into an executable plan", Kind: CmdPrompt,
		Prompt: func(args []string) string {
			return "Based on the above discussion, create a detailed implementation plan."
		},
	})
	r.Register(&Command{Name: "test", Description: "Run a smoke test of available tools", Kind: CmdPrompt,
		Prompt: func(args []string) string {
			return "Run a quick smoke test: verify you can use Read, Write, Edit, and Bash tools. Report which ones work."
		},
	})
	r.Register(&Command{Name: "compress", Description: "Compress conversation history", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.CompressFn != nil {
				ctx.CompressFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "effort", Description: "Set thinking effort (low|medium|high|xhigh|max)", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if len(args) > 0 && ctx.SetEffortFn != nil {
				ctx.SetEffortFn(args[0])
			}
			return true
		},
	})
	r.Register(&Command{Name: "new", Description: "Create a new session", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			name := "session-" + fmt.Sprint(time.Now().UnixMilli())
			if len(args) > 0 {
				name = args[0]
			}
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			if ctx.SetSessionFn != nil {
				ctx.SetSessionFn(name)
			}
			return true
		},
	})
	r.Register(&Command{Name: "rename", Description: "Rename current session", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if len(args) > 0 && ctx.RenameSessionFn != nil {
				oldName := ctx.Agent.SessionName()
				ctx.RenameSessionFn(oldName, args[0])
				if ctx.SetSessionFn != nil {
					ctx.SetSessionFn(args[0])
				}
			}
			return true
		},
	})
	r.Register(&Command{Name: "resume", Description: "Load a session (without args: list sessions)", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if len(args) > 0 && ctx.LoadSessionFn != nil {
				if err := ctx.LoadSessionFn(args[0]); err != nil {
					return true
				}
			}
			// Listing sessions is handled externally (TUI switches input mode)
			return true
		},
	})
	r.Register(&Command{Name: "skills", Description: "List available skills", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			if ctx.ListSkillsFn != nil {
				ctx.ListSkillsFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "model", Description: "Switch model/provider via UI", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			// Model switching is handled externally (TUI shows model select)
			return true
		},
	})
}
