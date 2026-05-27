package tools

import (
	"context"
	"strings"
	"testing"

	"minicode/internal/domain"
)

func TestAskUserTool_Execute(t *testing.T) {
	at := NewAskUserTool()
	result, _ := at.Execute(context.Background(), map[string]any{
		"question": "Pick one",
		"options": []any{
			map[string]any{"label": "A", "description": "Option A"},
			map[string]any{"label": "B", "description": "Option B"},
		},
	}, ToolContext{
		AskUserFn: func(question string, options []domain.AskOption, multiSelect bool) string {
			return "A"
		},
	})
	if !strings.Contains(result.Output, "A") {
		t.Errorf("expected 'A', got %q", result.Output)
	}
}

func TestAskUserTool_NoPrompter(t *testing.T) {
	at := NewAskUserTool()
	result, _ := at.Execute(context.Background(), map[string]any{
		"question": "Pick one",
		"options": []any{
			map[string]any{"label": "A", "description": "Option A"},
		},
	}, ToolContext{})
	if !strings.Contains(result.Output, "No user prompter") {
		t.Errorf("expected prompter error, got %q", result.Output)
	}
}

func TestAskUserTool_NoValidOptions(t *testing.T) {
	at := NewAskUserTool()
	result, _ := at.Execute(context.Background(), map[string]any{
		"question": "Pick one",
		"options":  []any{},
	}, ToolContext{
		AskUserFn: func(question string, options []domain.AskOption, multiSelect bool) string {
			return "A"
		},
	})
	if !strings.Contains(result.Output, "No valid options") {
		t.Errorf("expected options error, got %q", result.Output)
	}
}

func TestAskUserTool_UserCancelled(t *testing.T) {
	at := NewAskUserTool()
	_, err := at.Execute(context.Background(), map[string]any{
		"question": "Pick one",
		"options": []any{
			map[string]any{"label": "A", "description": "Option A"},
		},
	}, ToolContext{
		AskUserFn: func(question string, options []domain.AskOption, multiSelect bool) string {
			return ""
		},
	})
	if err == nil {
		t.Error("expected ToolDeniedError for user cancellation")
	}
	if _, ok := err.(*ToolDeniedError); !ok {
		t.Errorf("expected ToolDeniedError, got %T", err)
	}
}
