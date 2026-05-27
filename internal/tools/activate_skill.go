package tools

import (
	"context"
	"fmt"

	"minicode/internal/domain"
	"minicode/internal/skills"
)

// ActivateSkillTool provides instructions for a specific skill.
type ActivateSkillTool struct{}

// NewActivateSkillTool creates an ActivateSkillTool.
func NewActivateSkillTool() *ActivateSkillTool {
	return &ActivateSkillTool{}
}

func (t *ActivateSkillTool) Name() string { return "ActivateSkill" }
func (t *ActivateSkillTool) Description() string {
	return "Activate a specific skill and receive its detailed instructions. Use this when the user requests a task related to a listed skill."
}
func (t *ActivateSkillTool) ReadOnly() bool    { return true }
func (t *ActivateSkillTool) Interactive() bool { return false }
func (t *ActivateSkillTool) Requires() []ToolRequirement { return nil }

func (t *ActivateSkillTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{"type": "string", "description": "The name of the skill to activate"},
		},
		"required": []string{"name"},
	}
}

func (t *ActivateSkillTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		tc.Log("ActivateSkill: name is required")
		return domain.ToolResult{Output: "Error: name is required"}, nil
	}

	tc.Log("ActivateSkill: activating skill", "name", name)

	body := skills.Body(name)
	if body == "" {
		tc.LogErr("ActivateSkill: skill not found", "name", name)
		return domain.ToolResult{Output: fmt.Sprintf("Error: Skill '%s' not found.", name)}, nil
	}

	tc.Log("ActivateSkill: skill activated", "name", name, "body_length", len(body))
	return domain.ToolResult{
		Output: fmt.Sprintf("<activated_skill name=\"%s\">\n<instructions>\n%s\n</instructions>\n</activated_skill>", name, body),
	}, nil
}

func init() { Register(NewActivateSkillTool()) }
