package tools

import (
	"context"
	"strings"
	"testing"
)

func TestSetModelTool_MissingTier(t *testing.T) {
	st := NewSetModelTool()
	result, _ := st.Execute(context.Background(), map[string]any{
		"model": "claude-3-5-sonnet@anthropic",
	}, ToolContext{})
	if !strings.Contains(result.Output, "tier and model are required") {
		t.Errorf("expected tier error, got %q", result.Output)
	}
}

func TestSetModelTool_MissingModel(t *testing.T) {
	st := NewSetModelTool()
	result, _ := st.Execute(context.Background(), map[string]any{
		"tier": "1",
	}, ToolContext{})
	if !strings.Contains(result.Output, "tier and model are required") {
		t.Errorf("expected model error, got %q", result.Output)
	}
}

func TestSetModelTool_EmptyArgs(t *testing.T) {
	st := NewSetModelTool()
	result, _ := st.Execute(context.Background(), map[string]any{}, ToolContext{})
	if !strings.Contains(result.Output, "tier and model are required") {
		t.Errorf("expected required error, got %q", result.Output)
	}
}
