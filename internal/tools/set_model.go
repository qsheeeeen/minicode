package tools

import (
	"context"
	"fmt"

	"minicode/internal/config"
	"minicode/internal/domain"
)

// SetModelTool updates the model for a specific tier.
type SetModelTool struct{}

// NewSetModelTool creates a SetModelTool.
func NewSetModelTool() *SetModelTool {
	return &SetModelTool{}
}

func (t *SetModelTool) Name() string { return "SetModel" }
func (t *SetModelTool) Description() string {
	return "Update the model associated with a specific tier (\"1\", \"2\", or \"3\"). Tier 1 is for simple tasks, Tier 2 for normal development, Tier 3 for complex architecture. Format: model@provider (e.g. claude-3-5-sonnet@anthropic)."
}
func (t *SetModelTool) ReadOnly() bool    { return false }
func (t *SetModelTool) Interactive() bool { return false }
func (t *SetModelTool) Requires() []ToolRequirement { return nil }

func (t *SetModelTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tier":  map[string]any{"type": "string", "enum": []string{"1", "2", "3"}},
			"model": map[string]any{"type": "string", "description": "model@provider format"},
		},
		"required": []string{"tier", "model"},
	}
}

func (t *SetModelTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	tier, _ := args["tier"].(string)
	modelSpec, _ := args["model"].(string)

	if tier == "" || modelSpec == "" {
		tc.Log("SetModel: tier and model are required")
		return domain.ToolResult{Output: "Error: tier and model are required"}, nil
	}

	tc.Log("SetModel: updating tier", "tier", tier, "model", modelSpec)

	// Persist to config
	if err := config.SetTier(tier, modelSpec); err != nil {
		tc.LogErr("SetModel: failed to persist tier", "tier", tier, "model", modelSpec, "error", err)
		return domain.ToolResult{Output: fmt.Sprintf("Error persisting tier: %s", err)}, nil
	}

	// Resolve the new spec to see if it's valid
	resolved, err := config.Resolve(modelSpec)
	if err != nil || resolved.Model.APIKey == "" {
		tc.LogErr("SetModel: resolution failed", "tier", tier, "model", modelSpec, "error", err)
		return domain.ToolResult{Output: fmt.Sprintf("Tier %s updated to %s, but resolution failed (check your API keys).", tier, modelSpec)}, nil
	}

	// Update the running agent immediately (pass full spec to preserve provider)
	if tc.SetModelFn != nil {
		tc.SetModelFn(modelSpec, resolved.Model.APIKey, resolved.Model.BaseURL, resolved.Model.ContextLength)
	}

	tc.Log("SetModel: tier updated", "tier", tier, "model", modelSpec, "provider", resolved.Model.Provider)
	return domain.ToolResult{
		Output: fmt.Sprintf("Switched to tier %s: %s", tier, modelSpec),
	}, nil
}

func init() { Register(NewSetModelTool()) }
