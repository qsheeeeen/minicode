package tools

import (
	"context"

	"minicode/internal/domain"
)

// AskUserTool asks the user a question with predefined options.
type AskUserTool struct{}

// NewAskUserTool creates an AskUserTool.
func NewAskUserTool() *AskUserTool {
	return &AskUserTool{}
}

func (t *AskUserTool) Name() string        { return "AskUser" }
func (t *AskUserTool) Description() string { return "Ask the user a question with predefined options." }
func (t *AskUserTool) RequiresPermission() bool { return false }
func (t *AskUserTool) Requires() []ToolRequirement { return nil }

func (t *AskUserTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"question":    map[string]any{"type": "string"},
			"multiSelect": map[string]any{"type": "boolean"},
			"options": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"label":       map[string]any{"type": "string"},
						"description": map[string]any{"type": "string"},
					},
					"required": []string{"label", "description"},
				},
			},
		},
		"required": []string{"question", "options"},
	}
}

func (t *AskUserTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	question, _ := args["question"].(string)
	multiSelect, _ := args["multiSelect"].(bool)
	rawOptions, _ := args["options"].([]any)

	if tc.AskUserFn == nil {
		return domain.ToolResult{Output: "Error: No user prompter available"}, nil
	}

	var options []domain.AskOption
	for _, opt := range rawOptions {
		if m, ok := opt.(map[string]any); ok {
			label, _ := m["label"].(string)
			desc, _ := m["description"].(string)
			if label != "" {
				options = append(options, domain.AskOption{Label: label, Description: desc})
			}
		}
	}

	if len(options) == 0 {
		return domain.ToolResult{Output: "Error: No valid options provided"}, nil
	}

	answer := tc.AskUserFn(question, options, multiSelect)
	return domain.ToolResult{Output: answer}, nil
}
