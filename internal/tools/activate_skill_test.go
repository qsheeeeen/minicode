package tools

import (
	"context"
	"strings"
	"testing"

	"minicode/internal/skills"
)

func TestActivateSkillTool_Found(t *testing.T) {
	sr := skills.NewSkillRegistry("")
	sr.RegisterBuiltin("---\nname: test-skill\ndescription: A test skill\n---\nskill body content")

	ast := NewActivateSkillTool()
	result, _ := ast.Execute(context.Background(), map[string]any{"name": "test-skill"}, ToolContext{Skills: sr})
	if !strings.Contains(result.Output, "<activated_skill") {
		t.Errorf("expected activated_skill tag, got %q", result.Output)
	}
	if !strings.Contains(result.Output, "skill body content") {
		t.Errorf("expected skill body, got %q", result.Output)
	}
}

func TestActivateSkillTool_NotFound(t *testing.T) {
	sr := skills.NewSkillRegistry("")
	ast := NewActivateSkillTool()
	result, _ := ast.Execute(context.Background(), map[string]any{"name": "nonexistent"}, ToolContext{Skills: sr})
	if !strings.Contains(result.Output, "not found") {
		t.Errorf("expected 'not found', got %q", result.Output)
	}
}
