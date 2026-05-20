// Package tools defines the Tool interface and registry.
package tools

import (
	"context"
	"errors"
)

// ErrToolDenied is returned when a tool execution is blocked by the permission gate.
var ErrToolDenied = errors.New("tool execution denied")

// ToolDeniedError wraps ErrToolDenied with context.
type ToolDeniedError struct {
	ToolName string
	Reason   string
}

func (e *ToolDeniedError) Error() string {
	return "tool denied: " + e.ToolName + " (" + e.Reason + ")"
}

func (e *ToolDeniedError) Unwrap() error {
	return ErrToolDenied
}

// Context provides tools with access to shared services.
type Context struct {
	Config         AgentConfig
	PermissionSvc  PermissionChecker
	CurrentAgentID string
}

// AgentConfig is the minimal agent configuration passed to tools.
type AgentConfig struct {
	APIKey        string
	BaseURL       string
	Model         string
	ContextLength int
}

// PermissionChecker is the interface tools use to gate execution.
type PermissionChecker interface {
	Check(toolName string, displayText string) (allowed bool, reason string)
	Mode() string
}

// Result is the structured return value from a tool execution.
type Result struct {
	Output string
}

// Tool is the interface every tool must implement.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Execute(ctx context.Context, args map[string]any, tc Context) (Result, error)
	RequiresPermission() bool
}
