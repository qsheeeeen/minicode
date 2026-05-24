package tools

import (
	"context"
	"fmt"

	"minicode/internal/domain"
)

// ActivateSkillTool provides instructions for a specific skill.
type ActivateSkillTool struct{}

// NewActivateSkillTool creates an ActivateSkillTool.
func NewActivateSkillTool() *ActivateSkillTool {
	return &ActivateSkillTool{}
}

func (t *ActivateSkillTool) Name() string        { return "ActivateSkill" }
func (t *ActivateSkillTool) Description() string { return "Activate a specific skill and receive its detailed instructions. Use this when the user requests a task related to a listed skill." }
func (t *ActivateSkillTool) RequiresPermission() bool { return false }
func (t *ActivateSkillTool) Requires() []ToolRequirement { return []ToolRequirement{ReqSkillRegistry} }

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
		return domain.ToolResult{Output: "Error: name is required"}, nil
	}

	if tc.Skills == nil {
		return domain.ToolResult{Output: "Error: No skill registry available"}, nil
	}

	body := tc.Skills.Body(name)
	if body == "" {
		return domain.ToolResult{Output: fmt.Sprintf("Error: Skill '%s' not found.", name)}, nil
	}

	return domain.ToolResult{
		Output: fmt.Sprintf("<activated_skill name=\"%s\">\n<instructions>\n%s\n</instructions>\n</activated_skill>", name, body),
	}, nil
}
