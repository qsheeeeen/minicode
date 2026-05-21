package tools

import (
	"context"
	"errors"
	"sync"

	"minicode/internal/domain"
	"minicode/internal/skills"
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
	Config          domain.AgentConfig
	PermissionSvc   PermissionChecker
	CurrentAgentID  string
	ParentRegistry  *ToolRegistry         // for sub-agent delegation
	AgentRegistry   AgentSessionManager   // interface to avoid circular dep
	AgentFactory    AgentFactory          // interface to create new agents
	Skills          *skills.SkillRegistry // for skill activation
	SetModelFn      func(model, apiKey, baseURL string, contextLength int)
	AskUserFn       func(question string, options []domain.AskOption, multiSelect bool) string
}

// AgentSessionManager defines what the tools need from the AgentRegistry.
type AgentSessionManager interface {
	AllocateSubID() string
	Register(id string, agent any, task string, parentID string)
	UpdateStatus(id string, status string, summary string)
}

// AgentFactory allows tools to create new agent instances.
type AgentFactory interface {
	Create(cfg domain.AgentConfig) any
	Run(agent any, ctx context.Context, task string) error
	GetTurns(agent any) []domain.MessageParam
}

// PermissionChecker is the interface tools use to gate execution.
type PermissionChecker interface {
	Check(toolName, displayText string, toolInput map[string]any) (allowed bool, reason string)
	Mode() domain.PermissionMode
	CycleMode() domain.PermissionMode
}

// ToolRequirement declares a service dependency for tool registration.
type ToolRequirement string

const (
	ReqAgentRegistry ToolRequirement = "agentRegistry"
	ReqSkillRegistry ToolRequirement = "skillRegistry"
)

// Tool is the interface every tool must implement.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error)
	RequiresPermission() bool
	Requires() []ToolRequirement
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
