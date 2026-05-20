package internal

import (
	"context"
	"fmt"
	"strings"
)

// SubAgentTool delegates work to a sub-agent (specialised LLM instance).
type SubAgentTool struct {
	parentConfig AgentConfig
}

// NewSubAgentTool creates a SubAgentTool.
func NewSubAgentTool(parentConfig AgentConfig) *SubAgentTool {
	return &SubAgentTool{parentConfig: parentConfig}
}

func (t *SubAgentTool) Name() string             { return "SubAgent" }
func (t *SubAgentTool) Description() string      { return "Launch a new agent to handle complex, multi-step tasks." }
func (t *SubAgentTool) RequiresPermission() bool { return false }

func (t *SubAgentTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"description": map[string]any{"type": "string", "description": "A short (3-5 word) description of the task"},
			"prompt":      map[string]any{"type": "string", "description": "The task for the agent to perform"},
		},
		"required": []string{"description", "prompt"},
	}
}

func (t *SubAgentTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	prompt, _ := args["prompt"].(string)
	description, _ := args["description"].(string)
	if prompt == "" {
		return ToolResult{Output: "Error: prompt is required"}, nil
	}

	subCfg := t.parentConfig
	subCfg.ExcludeTools = nil

	subAgent := NewAgent(subCfg)
	for _, tool := range tc.ParentRegistry.All() {
		if tool.Name() == "SubAgent" {
			continue
		}
		subAgent.tools.Register(tool)
	}

	ok, err := subAgent.Run(ctx, prompt, "")
	if err != nil {
		return ToolResult{Output: fmt.Sprintf("Sub-agent error: %s", err.Error())}, nil
	}
	_ = ok

	subTurns := subAgent.store.Turns()
	var output strings.Builder
	for _, turn := range subTurns {
		if turn.Role == "assistant" {
			if blocks, ok := turn.Content.([]ContentBlock); ok {
				for _, block := range blocks {
					if block.Type == "text" {
						output.WriteString(block.Text)
						output.WriteString("\n")
					}
				}
			}
		}
	}

	result := output.String()
	if result == "" {
		result = fmt.Sprintf("(Sub-agent '%s' completed)", description)
	}
	return ToolResult{Output: strings.TrimSpace(result)}, nil
}
