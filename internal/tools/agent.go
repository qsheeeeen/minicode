package tools

import (
	"context"
	"fmt"
	"strings"

	"minicode/internal/config"
	"minicode/internal/domain"
)

// SubAgentTool delegates work to a sub-agent with optional tier-based model override.
type SubAgentTool struct {
	parentConfig domain.AgentConfig
}

// NewSubAgentTool creates a SubAgentTool.
func NewSubAgentTool(parentConfig domain.AgentConfig) *SubAgentTool {
	return &SubAgentTool{parentConfig: parentConfig}
}

func (t *SubAgentTool) Name() string             { return "SubAgent" }
func (t *SubAgentTool) Description() string      { return "Delegate a sub-task to an independent agent. Creates a new agent session. The sub-agent has access to all tools (except SubAgent) and returns a concise summary." }
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

func (t *SubAgentTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	task, _ := args["task"].(string)
	tier, _ := args["tier"].(string)
	if task == "" {
		return domain.ToolResult{Output: "Error: task is required"}, nil
	}

	if tc.AgentFactory == nil {
		return domain.ToolResult{Output: "Error: No agent factory available"}, nil
	}

	subCfg := t.parentConfig

	// Override model from tier mapping
	if tier != "" {
		cfg, err := config.Load()
		if err == nil && cfg.Tiers != nil {
			if modelSpec, ok := cfg.Tiers[tier]; ok {
				resolved, err := config.Resolve(modelSpec)
				if err == nil && resolved.Model.APIKey != "" {
					subCfg.Model = resolved.Model.Model
					subCfg.APIKey = resolved.Model.APIKey
					subCfg.BaseURL = resolved.Model.BaseURL
					subCfg.ContextLength = resolved.Model.ContextLength
				}
			}
		}
	}

	subID := "2"
	if tc.AgentRegistry != nil {
		subID = tc.AgentRegistry.AllocateSubID()
	}

	subAgent := tc.AgentFactory.Create(subCfg)
	
	if tc.AgentRegistry != nil {
		tc.AgentRegistry.Register(subID, subAgent, task, tc.CurrentAgentID)
	}

	err := tc.AgentFactory.Run(ctx, subAgent, task)
	if err != nil {
		if tc.AgentRegistry != nil {
			tc.AgentRegistry.UpdateStatus(subID, "error", err.Error())
		}
		return domain.ToolResult{Output: fmt.Sprintf("Agent #%s failed: %s", subID, err.Error())}, nil
	}

	// Extract final response from sub-agent turns
	subTurns := tc.AgentFactory.GetTurns(subAgent)
	finalText := extractFinalResponse(subTurns)
	
	summary := ""
	if finalText != "" {
		summary = finalText
	} else {
		// Fallback: summary with tool call count
		toolCalls := 0
		for _, turn := range subTurns {
			if turn.Role == "assistant" {
				if blocks, ok := turn.Content.([]domain.ContentBlock); ok {
					for _, b := range blocks {
						if b.Type == "tool_use" {
							toolCalls++
						}
					}
				}
			}
		}
		summary = fmt.Sprintf("%d operations", toolCalls)
		if toolCalls == 0 {
			summary = "Task completed"
		}
	}

	if tc.AgentRegistry != nil {
		tc.AgentRegistry.UpdateStatus(subID, "completed", summary)
	}

	return domain.ToolResult{Output: summary}, nil
}

func extractFinalResponse(turns []domain.MessageParam) string {
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "assistant" {
			if blocks, ok := turns[i].Content.([]domain.ContentBlock); ok {
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
