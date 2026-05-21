package tools

import (
	"context"
	"strings"
	"testing"
)

func TestBashTool_Execute(t *testing.T) {
	bt := NewBashTool()
	result, _ := bt.Execute(context.Background(), map[string]any{"command": "echo hello"}, ToolContext{})
	if result.Output != "hello" {
		t.Errorf("expected 'hello', got %q", result.Output)
	}
}

func TestBashTool_NonZeroExit(t *testing.T) {
	bt := NewBashTool()
	result, _ := bt.Execute(context.Background(), map[string]any{"command": "exit 1"}, ToolContext{})
	if !strings.Contains(result.Output, "Exit code 1") {
		t.Errorf("expected exit code error, got %q", result.Output)
	}
}

func TestBashTool_CommandNotFound(t *testing.T) {
	bt := NewBashTool()
	result, _ := bt.Execute(context.Background(), map[string]any{"command": "nonexistent_command_xyz"}, ToolContext{})
	if result.Output == "" {
		t.Error("expected error output for missing command")
	}
}
