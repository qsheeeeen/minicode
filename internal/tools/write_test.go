package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteTool_Execute(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")

	wt := NewWriteTool()
	result, _ := wt.Execute(context.Background(), map[string]any{"path": path, "content": "hello world"}, ToolContext{})
	if !strings.Contains(result.Output, path) {
		t.Errorf("expected path in output, got %q", result.Output)
	}

	data, _ := os.ReadFile(path)
	if string(data) != "hello world" {
		t.Errorf("file content mismatch: %q", string(data))
	}
}

func TestWriteTool_CreatesParentDir(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "sub", "dir", "test.txt")

	wt := NewWriteTool()
	result, _ := wt.Execute(context.Background(), map[string]any{"path": path, "content": "nested"}, ToolContext{})
	if !strings.Contains(result.Output, path) {
		t.Errorf("expected success, got %q", result.Output)
	}

	data, _ := os.ReadFile(path)
	if string(data) != "nested" {
		t.Errorf("file content mismatch: %q", string(data))
	}
}

func TestWriteTool_ErrorOnFailure(t *testing.T) {
	wt := NewWriteTool()
	result, _ := wt.Execute(context.Background(), map[string]any{"path": "/proc/readonly/test.txt", "content": "x"}, ToolContext{})
	if result.Output == "" {
		t.Error("expected error output")
	}
}
