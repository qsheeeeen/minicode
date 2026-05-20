package internal

import (
	"context"
	"fmt"
)

// ActivateSkillTool loads a skill's full instructions by name.
type ActivateSkillTool struct {
	skills *SkillRegistry
}

// NewActivateSkillTool creates an ActivateSkillTool.
func NewActivateSkillTool(skills *SkillRegistry) *ActivateSkillTool {
	return &ActivateSkillTool{skills: skills}
}

func (t *ActivateSkillTool) Name() string             { return "ActivateSkill" }
func (t *ActivateSkillTool) Description() string      { return "Loads the full instructions of a skill by name. Returns the skill's instructions wrapped in <activated_skill> tags." }
func (t *ActivateSkillTool) RequiresPermission() bool     { return false }
func (t *ActivateSkillTool) Requires() []ToolRequirement  { return []ToolRequirement{ReqSkillRegistry} }

func (t *ActivateSkillTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{"type": "string", "description": "The name of the skill to activate."},
		},
		"required": []string{"name"},
	}
}

func (t *ActivateSkillTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	skillName, _ := args["name"].(string)
	if t.skills == nil {
		return ToolResult{Output: fmt.Sprintf("Error: Skill '%s' not found.", skillName)}, nil
	}
	body := t.skills.GetBody(skillName)
	if body == "" {
		return ToolResult{Output: fmt.Sprintf("Error: Skill '%s' not found.", skillName)}, nil
	}
	output := fmt.Sprintf("<activated_skill name=\"%s\">\n<instructions>\n%s\n</instructions>\n</activated_skill>", skillName, body)
	return ToolResult{Output: output}, nil
}
