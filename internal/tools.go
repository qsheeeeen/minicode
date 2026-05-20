package internal

import (
	"context"
	"errors"
	"sync"
)

// ErrToolDenied is returned when a tool execution is blocked by the permission gate.
var ErrToolDenied = errors.New("tool execution denied")

// ToolDeniedError wraps ErrToolDenied with context.
type ToolDeniedError struct {
	ToolName string
	Reason   string
}

func (e *ToolDeniedError) Error() string { return "tool denied: " + e.ToolName + " (" + e.Reason + ")" }
func (e *ToolDeniedError) Unwrap() error { return ErrToolDenied }

// AskOption is a single option presented to the user.
type AskOption struct {
	Label       string
	Description string
}

// ToolContext provides tools with access to shared services.
type ToolContext struct {
	Config          AgentConfig
	PermissionSvc   PermissionChecker
	CurrentAgentID  string
	ParentRegistry  *ToolRegistry   // for sub-agent delegation
	Skills          *SkillRegistry  // for skill activation
	SetModelFn      func(model, apiKey, baseURL string, contextLength int) // for model switching
	AskUserFn       func(question string, options []AskOption, multiSelect bool) string
}

// AgentConfig is the full agent configuration, shared between the agent and tools.
type AgentConfig struct {
	APIKey                    string
	BaseURL                   string
	Model                     string
	ContextLength             int
	CompressionThresholdRatio float64
	ThinkingEnabled           bool
	UserPrompt                string
	ProjectPromptFile         string
	ExcludeTools              []string
}

// PermissionChecker is the interface tools use to gate execution.
type PermissionChecker interface {
	Check(toolName, displayText string) (allowed bool, reason string)
	Mode() PermissionMode
	CycleMode() PermissionMode
}

// ToolResult is the structured return value from a tool execution.
type ToolResult struct {
	Output string
}

// Tool is the interface every tool must implement.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error)
	RequiresPermission() bool
}

// ToolRegistry holds registered tools and provides lookup.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewToolRegistry creates an empty tool registry.
func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{tools: make(map[string]Tool)}
}

// Register adds a tool to the registry.
func (r *ToolRegistry) Register(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[t.Name()] = t
}

// Get retrieves a tool by name.
func (r *ToolRegistry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// All returns all registered tools.
func (r *ToolRegistry) All() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		result = append(result, t)
	}
	return result
}
