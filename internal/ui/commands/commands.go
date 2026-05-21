// Package commands provides the slash-command registry and builtin commands.
package commands

import (
	"sort"
	"strings"

	"minicode/internal/agent"
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
	Handler     func(args []string, ctx Context) bool
	Prompt      func(args []string) string
}

// Context provides commands with access to the application.
type Context struct {
	Agent            *agent.Agent
	ClearFn          func()
	ExitFn           func()
	SetSessionFn     func(name string)
	CompressFn       func()
	ListSkillsFn     func() string
	ListSessionsFn   func() string
	LoadSessionFn    func(name string)
	RenameSessionFn  func(oldName, newName string) error
}

// Registry holds registered slash commands.
type Registry struct {
	commands map[string]*Command
}

// NewRegistry creates an empty command registry.
func NewRegistry() *Registry {
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
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list
}

// ParseAndExecute parses a command string and runs the handler if found.
func (r *Registry) ParseAndExecute(input string, ctx Context) (handled bool, promptText string) {
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

	if cmd.Kind == Handler && cmd.Handler != nil {
		cmd.Handler(args, ctx)
		return true, ""
	}

	if cmd.Kind == Prompt && cmd.Prompt != nil {
		return true, cmd.Prompt(args)
	}

	return false, ""
}

// RegisterBuiltins adds all 11 standard slash commands.
func (r *Registry) RegisterBuiltins() {
	registerExit(r)
	registerClear(r)
	registerCompress(r)
	registerEffort(r)
	registerNew(r)
	registerRename(r)
	registerResume(r)
	registerPlan(r)
	registerTest(r)
	registerSkills(r)
	registerModel(r)
}
