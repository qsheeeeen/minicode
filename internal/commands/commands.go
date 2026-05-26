// Package commands provides the slash-command registry and builtin commands.
// It is UI-agnostic: commands return Result values that callers (TUI or headless)
// interpret and action on.
package commands

import (
	"fmt"
	"sort"
	"strings"

	"minicode/internal/agent"
	"minicode/internal/config"
	"minicode/internal/skills"
	"minicode/internal/storage"
)

// Kind distinguishes handler commands from prompt-expanding commands.
type Kind string

const (
	Handler Kind = "handler"
	Prompt  Kind = "prompt"
)

// Command is a slash command definition.
type Command struct {
	Name        string
	Description string
	Kind        Kind
	Handler     func(args []string, ctx Context) (Result, error)
	Prompt      func(args []string) string
}

// Context provides commands with access to core services.
type Context struct {
	Agent    *agent.Agent
	Config   *config.Config
	Sessions []storage.SessionInfo
}

// Result is returned by command handlers to indicate what the caller should do.
type Result interface {
	resultMarker()
}

// HandledResult means the command was handled; no further action needed.
type HandledResult struct{}

func (HandledResult) resultMarker() {}

// StatusResult means the caller should display a status or error message.
type StatusResult struct {
	Message string
	IsError bool
}

func (StatusResult) resultMarker() {}

// SelectResult means the caller should present a selection UI.
type SelectResult struct {
	Mode  string
	Title string
	Items []SelectItem
}

func (SelectResult) resultMarker() {}

// ExitResult means the caller should exit the program.
type ExitResult struct{}

func (ExitResult) resultMarker() {}

// SetInputResult means the caller should set the input field value.
type SetInputResult struct {
	Value string
}

func (SetInputResult) resultMarker() {}

// SelectItem is a generic selection item (no UI dependency).
type SelectItem struct {
	Value       string // returned value on selection
	Label       string // display text
	Description string // optional description
}

// Registry holds registered slash commands.
type Registry struct {
	commands map[string]*Command
}

// newRegistry creates an empty command registry.
func newRegistry() *Registry {
	return &Registry{commands: make(map[string]*Command)}
}

// Register adds a command.
func (r *Registry) Register(cmd *Command) {
	r.commands[cmd.Name] = cmd
}

// Get returns a command by name.
func (r *Registry) Get(name string) (*Command, bool) {
	cmd, ok := r.commands[name]
	return cmd, ok
}

// List returns all registered commands, sorted by name.
func (r *Registry) List() []Command {
	var list []Command
	for _, cmd := range r.commands {
		list = append(list, *cmd)
	}
	for _, sk := range skills.List() {
		if _, ok := r.commands[sk.Name]; !ok {
			skName := sk.Name
			list = append(list, Command{
				Name:        skName,
				Description: sk.Description,
				Kind:        Prompt,
				Prompt: func(args []string) string {
					return fmt.Sprintf("Activate and execute the '%s' skill.", skName)
				},
			})
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list
}

// ParseAndExecute parses a command string and runs the handler if found.
// Returns handled=true when a slash command was recognised.
// For Handler commands, the Result describes what action to take.
// For Prompt commands, promptText is the expanded prompt string.
func (r *Registry) ParseAndExecute(input string, ctx Context) (handled bool, result Result, promptText string) {
	if len(input) == 0 || input[0] != '/' {
		return false, nil, ""
	}

	parts := strings.SplitN(input[1:], " ", 2)
	name := strings.TrimSpace(parts[0])
	var args []string
	if len(parts) > 1 {
		args = []string{strings.TrimSpace(parts[1])}
	}

	cmd, ok := r.Get(name)
	if !ok {
		return false, nil, ""
	}

	if cmd.Kind == Handler && cmd.Handler != nil {
		result, err := cmd.Handler(args, ctx)
		if err != nil {
			return true, StatusResult{Message: err.Error(), IsError: true}, ""
		}
		return true, result, ""
	}

	if cmd.Kind == Prompt && cmd.Prompt != nil {
		return true, nil, cmd.Prompt(args)
	}

	return false, nil, ""
}

// Default registry singleton.
var defaultRegistry = newRegistry()

// Register adds a command to the default registry.
func Register(cmd *Command) { defaultRegistry.Register(cmd) }

// Get returns a command by name from the default registry.
func Get(name string) (*Command, bool) { return defaultRegistry.Get(name) }

// List returns all registered commands from the default registry.
func List() []Command { return defaultRegistry.List() }

// ParseAndExecute parses a command string and runs the handler from the default registry.
func ParseAndExecute(input string, ctx Context) (bool, Result, string) {
	return defaultRegistry.ParseAndExecute(input, ctx)
}
