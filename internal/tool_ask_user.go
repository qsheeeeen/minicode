package internal

import (
	"context"
	"encoding/json"
	"fmt"
)

// AskUserTool asks the user a question with predefined options.
type AskUserTool struct {
	promptFn func(question string, options []AskOption, multiSelect bool) string
}

// AskOption is a single option presented to the user.
type AskOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

// NewAskUserTool creates an AskUserTool.
func NewAskUserTool(promptFn func(question string, options []AskOption, multiSelect bool) string) *AskUserTool {
	return &AskUserTool{promptFn: promptFn}
}

func (t *AskUserTool) Name() string             { return "AskUser" }
func (t *AskUserTool) Description() string      { return "Ask the user a question with predefined options." }
func (t *AskUserTool) RequiresPermission() bool { return false }

func (t *AskUserTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"question": map[string]any{"type": "string", "description": "The question to ask the user."},
			"options": map[string]any{
				"type":  "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"label":       map[string]any{"type": "string", "description": "Short label for the option"},
						"description": map[string]any{"type": "string", "description": "Explanation of what this option means"},
					},
					"required": []string{"label", "description"},
				},
				"minItems":    2,
				"maxItems":    4,
				"description": "2-4 mutually exclusive options for the user to choose from.",
			},
			"multiSelect": map[string]any{"type": "boolean", "description": "Set to true to allow multiple selections."},
		},
		"required": []string{"question", "options"},
	}
}

func (t *AskUserTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	question, _ := args["question"].(string)
	multiSelect, _ := args["multiSelect"].(bool)

	var options []AskOption
	if rawOpts, ok := args["options"].([]any); ok {
		for _, raw := range rawOpts {
			if m, ok := raw.(map[string]any); ok {
				label, _ := m["label"].(string)
				desc, _ := m["description"].(string)
				options = append(options, AskOption{Label: label, Description: desc})
			}
		}
	}

	if len(options) == 0 {
		b, _ := json.Marshal(args["options"])
		return ToolResult{Output: fmt.Sprintf("Error: AskUser tool requires 'options' to be an array, received: %s", string(b))}, nil
	}

	if t.promptFn != nil {
		answer := t.promptFn(question, options, multiSelect)
		if answer == "" {
			return ToolResult{}, &ToolDeniedError{ToolName: "AskUser", Reason: "User cancelled the question"}
		}
		return ToolResult{Output: fmt.Sprintf("User selected: %q", answer)}, nil
	}

	return ToolResult{Output: "Error: No user prompter available"}, nil
}
