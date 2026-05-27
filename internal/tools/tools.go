package tools

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"minicode/internal/domain"
	"minicode/internal/services"
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

// ToolContext provides tools with access to shared services.
type ToolContext struct {
	Config         domain.AgentConfig
	PermissionSvc  services.PermissionChecker
	CurrentAgentID string
	AgentFactory   AgentFactory // interface to create new agents
	SetModelFn     func(model, apiKey, baseURL string, contextLength int)
	AskUserFn      func(question string, options []domain.AskOption, multiSelect bool) string
	Logger         *slog.Logger
}

// Log logs a message using the tool context's logger.
func (tc ToolContext) Log(msg string, attrs ...any) {
	if tc.Logger != nil {
		tc.Logger.Info(msg, attrs...)
	}
}

// LogErr logs an error using the tool context's logger.
func (tc ToolContext) LogErr(msg string, attrs ...any) {
	if tc.Logger != nil {
		tc.Logger.Error(msg, attrs...)
	}
}

// AgentFactory allows tools to create new agent instances.
type AgentFactory interface {
	Create(cfg domain.AgentConfig) any
	Run(ctx context.Context, agent any, task string) error
	GetTurns(agent any) []domain.MessageParam
}

// ToolRequirement declares a service dependency for tool registration.
type ToolRequirement string

const (
// Removed ReqSkillRegistry
)

// Tool is the interface every tool must implement.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error)
	ReadOnly() bool    // true if the tool has no side effects
	Interactive() bool // true if the tool requires user interaction
	Requires() []ToolRequirement
}

// ToolRegistry holds registered tools and provides lookup.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// newToolRegistry creates an empty tool registry.
func newToolRegistry() *ToolRegistry {
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

// SubAgentTools returns tools safe for sub-agents: read-only and non-interactive.
func (r *ToolRegistry) SubAgentTools() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Tool, 0)
	for _, t := range r.tools {
		if t.ReadOnly() && !t.Interactive() {
			result = append(result, t)
		}
	}
	return result
}


// Default registry singleton.
var defaultRegistry = newToolRegistry()

// Register adds a tool to the default registry.
func Register(t Tool) { defaultRegistry.Register(t) }

// Get retrieves a tool by name from the default registry.
func Get(name string) (Tool, bool) { return defaultRegistry.Get(name) }

// All returns all registered tools from the default registry.
func All() []Tool { return defaultRegistry.All() }

// SubAgentTools returns tools safe for sub-agents from the default registry.
func SubAgentTools() []Tool { return defaultRegistry.SubAgentTools() }
