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

func (t *SetModelTool) Name() string        { return "SetModel" }
func (t *SetModelTool) Description() string { return "Update the model associated with a specific tier (\"1\", \"2\", or \"3\"). Tier 1 is for simple tasks, Tier 2 for normal development, Tier 3 for complex architecture. Format: model@provider (e.g. claude-3-5-sonnet@anthropic)." }
func (t *SetModelTool) RequiresPermission() bool { return true }
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
		return domain.ToolResult{Output: "Error: tier and model are required"}, nil
	}

	// Persist to config
	if err := config.SetTier(tier, modelSpec); err != nil {
		return domain.ToolResult{Output: fmt.Sprintf("Error persisting tier: %s", err)}, nil
	}

	// Resolve the new spec to see if it's valid
	resolved, err := config.Resolve(modelSpec)
	if err != nil || resolved.Model.APIKey == "" {
		return domain.ToolResult{Output: fmt.Sprintf("Tier %s updated to %s, but resolution failed (check your API keys).", tier, modelSpec)}, nil
	}

	// If this tier is currently active, update the running agent immediately
	if tc.SetModelFn != nil {
		tc.SetModelFn(resolved.Model.Model, resolved.Model.APIKey, resolved.Model.BaseURL, resolved.Model.ContextLength)
	}
	return domain.ToolResult{
		Output: fmt.Sprintf("Successfully mapped Tier %s to %s (%s)", tier, modelSpec, resolved.Model.Model),
	}, nil
}
