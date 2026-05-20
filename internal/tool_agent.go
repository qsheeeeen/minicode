package internal

import (
	"context"
	"fmt"
	"strings"
)

// SubAgentTool delegates work to a sub-agent with optional tier-based model override.
type SubAgentTool struct {
	parentConfig AgentConfig
}

// NewSubAgentTool creates a SubAgentTool.
func NewSubAgentTool(parentConfig AgentConfig) *SubAgentTool {
	return &SubAgentTool{parentConfig: parentConfig}
}

func (t *SubAgentTool) Name() string             { return "SubAgent" }
func (t *SubAgentTool) Description() string      { return "Delegate a sub-task to an independent agent. Creates a new agent session that runs in parallel. The sub-agent has access to all tools (except SubAgent) and returns a concise summary." }
func (t *SubAgentTool) RequiresPermission() bool     { return false }
func (t *SubAgentTool) Requires() []ToolRequirement  { return []ToolRequirement{ReqAgentRegistry} }

func (t *SubAgentTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"task": map[string]any{"type": "string", "description": "The specific task to delegate to the sub-agent"},
			"tier": map[string]any{"type": "string", "description": "Optional: run the sub-agent with the model mapped to this tier (\"1\", \"2\", or \"3\")."},
		},
		"required": []string{"task"},
	}
}

func (t *SubAgentTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	task, _ := args["task"].(string)
	tier, _ := args["tier"].(string)
	if task == "" {
		return ToolResult{Output: "Error: task is required"}, nil
	}

	subCfg := t.parentConfig

	// Override model from tier mapping
	if tier != "" {
		cfg, err := LoadConfig()
		if err == nil && cfg.Tiers != nil {
			if modelSpec, ok := cfg.Tiers[tier]; ok {
				resolved, err := ResolveConfig(modelSpec)
				if err == nil && resolved.Model.APIKey != "" {
					subCfg.Model = resolved.Model.Model
					subCfg.APIKey = resolved.Model.APIKey
					subCfg.BaseURL = resolved.Model.BaseURL
					subCfg.ContextLength = resolved.Model.ContextLength
				}
			}
		}
	}

	subAgent := NewAgent(subCfg)
	for _, tool := range tc.ParentRegistry.All() {
		if tool.Name() == "SubAgent" {
			continue
		}
		subAgent.tools.Register(tool)
	}

	ok, err := subAgent.Run(ctx, task, "")
	if err != nil {
		return ToolResult{Output: fmt.Sprintf("Sub-agent error: %s", err.Error())}, nil
	}
	_ = ok

	// Extract final response from sub-agent turns
	subTurns := subAgent.store.Turns()
	finalText := extractFinalResponse(subTurns)
	if finalText != "" {
		return ToolResult{Output: finalText}, nil
	}

	// Fallback: summary with tool call count
	toolCalls := 0
	for _, turn := range subTurns {
		if turn.Role == "assistant" {
			if blocks, ok := turn.Content.([]ContentBlock); ok {
				for _, b := range blocks {
					if b.Type == "tool_use" {
						toolCalls++
					}
				}
			}
		}
	}
	summary := fmt.Sprintf("%d operations", toolCalls)
	if toolCalls == 0 {
		summary = "Task completed"
	}
	return ToolResult{Output: fmt.Sprintf("(Sub-agent completed: %s)", summary)}, nil
}

func extractFinalResponse(turns []MessageParam) string {
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "assistant" {
			if blocks, ok := turns[i].Content.([]ContentBlock); ok {
				for _, b := range blocks {
					if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
						return strings.TrimSpace(b.Text)
					}
				}
			}
		}
	}
	return ""
}
