package internal

import (
	"context"
	"fmt"
)

// SetModelTool switches the current model based on configured tiers.
type SetModelTool struct {
	setModelFn func(modelSpec string) error
}

// NewSetModelTool creates a SetModelTool.
func NewSetModelTool(setModelFn func(modelSpec string) error) *SetModelTool {
	return &SetModelTool{setModelFn: setModelFn}
}

func (t *SetModelTool) Name() string             { return "SetModel" }
func (t *SetModelTool) Description() string      { return "Switch the current conversation to the model mapped to a tier. Looks up config tiers and switches both the running agent and persisted config." }
func (t *SetModelTool) RequiresPermission() bool { return false }

func (t *SetModelTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tier": map[string]any{"type": "string", "description": "The tier number: \"1\", \"2\", or \"3\""},
		},
		"required": []string{"tier"},
	}
}

func (t *SetModelTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	tier, _ := args["tier"].(string)
	if tier == "" {
		return ToolResult{Output: "Error: tier is required"}, nil
	}

	// Load tiers from config
	cfg, err := LoadConfig()
	if err != nil || cfg.Tiers == nil {
		return ToolResult{Output: fmt.Sprintf("Error: No model mapped to tier %s.", tier)}, nil
	}

	modelSpec, ok := cfg.Tiers[tier]
	if !ok || modelSpec == "" {
		return ToolResult{Output: fmt.Sprintf("Error: No model mapped to tier %s.", tier)}, nil
	}

	// Resolve the model spec
	resolved, err := ResolveConfig(modelSpec)
	if err != nil || resolved.Model.APIKey == "" {
		return ToolResult{Output: fmt.Sprintf("Error: Could not resolve %q for tier %s.", modelSpec, tier)}, nil
	}

	// Update the agent model
	if tc.SetModelFn != nil {
		tc.SetModelFn(resolved.Model.Model, resolved.Model.APIKey, resolved.Model.BaseURL, resolved.Model.ContextLength)
	}

	// Persist the change to config
	if t.setModelFn != nil {
		_ = t.setModelFn(modelSpec)
	}

	return ToolResult{Output: fmt.Sprintf("Switched to tier %s: %s", tier, modelSpec)}, nil
}
