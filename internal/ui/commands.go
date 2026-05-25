package ui

import (
	"minicode/internal/commands"
)

// Re-export types from the commands package for backward compatibility.
type (
	Command         = commands.Command
	CommandContext  = commands.Context
	CommandKind     = commands.Kind
	CommandRegistry = commands.Registry
)

const (
	CmdHandler = commands.Handler
	CmdPrompt  = commands.Prompt
)

var NewCommandRegistry = commands.NewRegistry
