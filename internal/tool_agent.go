package internal

import (
	"context"
	"fmt"
	"strings"
)

// AgentTool delegates work to a sub-agent (specialised LLM instance).
type AgentTool struct {
	parentConfig AgentConfig
}

// NewAgentTool creates an AgentTool.
func NewAgentTool(parentConfig AgentConfig) *AgentTool {
	return &AgentTool{parentConfig: parentConfig}
}

func (t *AgentTool) Name() string             { return "Agent" }
func (t *AgentTool) Description() string      { return "Launch a new agent to handle complex, multi-step tasks." }
func (t *AgentTool) RequiresPermission() bool { return false }

func (t *AgentTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"description": map[string]any{"type": "string", "description": "A short (3-5 word) description of the task"},
			"prompt":      map[string]any{"type": "string", "description": "The task for the agent to perform"},
		},
		"required": []string{"description", "prompt"},
	}
}

func (t *AgentTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	prompt, _ := args["prompt"].(string)
	description, _ := args["description"].(string)
	if prompt == "" {
		return ToolResult{Output: "Error: prompt is required"}, nil
	}

	// Create a sub-agent with the same config but no tools (to avoid recursion)
	subCfg := t.parentConfig
	subCfg.ExcludeTools = nil // sub-agents get all tools too for now

	subAgent := NewAgent(subCfg)
	// Copy tools from parent
	for _, tool := range tc.ParentRegistry.All() {
		if tool.Name() == "Agent" {
			continue // Don't allow recursive agent spawning
		}
		subAgent.tools.Register(tool)
	}

	// Run the sub-agent with the prompt
	ok, err := subAgent.Run(ctx, prompt)
	if err != nil {
		return ToolResult{Output: fmt.Sprintf("Sub-agent error: %s", err.Error())}, nil
	}
	_ = ok

	// Collect the sub-agent's response as the result
	subTurns := subAgent.store.GetTurns()
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
