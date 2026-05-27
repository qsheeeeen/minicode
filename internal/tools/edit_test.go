package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEditTool_ReplaceText(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("hello world"), 0o644)

	et := NewEditTool()
	result, _ := et.Execute(context.Background(), map[string]any{
		"path": path, "oldText": "world", "newText": "minicode",
	}, ToolContext{})
	if !strings.Contains(result.Output, "Edited") {
		t.Errorf("expected 'Edited', got %q", result.Output)
	}

	data, _ := os.ReadFile(path)
	if string(data) != "hello minicode" {
		t.Errorf("expected 'hello minicode', got %q", string(data))
	}
}

func TestEditTool_ReplaceFirstOnly(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("foo bar foo"), 0o644)

	et := NewEditTool()
	result, _ := et.Execute(context.Background(), map[string]any{
		"path": path, "oldText": "foo", "newText": "baz",
	}, ToolContext{})

	// Without replaceAll, multiple matches should return an error
	if !strings.Contains(result.Output, "found 2 times") {
		t.Errorf("expected error about multiple matches, got %q", result.Output)
	}

	// File should not be modified
	data, _ := os.ReadFile(path)
	if string(data) != "foo bar foo" {
		t.Errorf("expected file unchanged, got %q", string(data))
	}
}

func TestEditTool_ReplaceAll(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("foo bar foo"), 0o644)

	et := NewEditTool()
	result, _ := et.Execute(context.Background(), map[string]any{
		"path": path, "oldText": "foo", "newText": "baz", "replaceAll": true,
	}, ToolContext{})

	if !strings.Contains(result.Output, "2 replacement(s)") {
		t.Errorf("expected 2 replacements, got %q", result.Output)
	}

	data, _ := os.ReadFile(path)
	if string(data) != "baz bar baz" {
		t.Errorf("expected 'baz bar baz', got %q", string(data))
	}
}

func TestEditTool_OldTextNotFound(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("hello world"), 0o644)

	et := NewEditTool()
	result, _ := et.Execute(context.Background(), map[string]any{
		"path": path, "oldText": "nonexistent", "newText": "x",
	}, ToolContext{})
	if !strings.Contains(result.Output, "oldText not found") {
		t.Errorf("expected 'oldText not found', got %q", result.Output)
	}
}

func TestEditTool_FileNotFound(t *testing.T) {
	et := NewEditTool()
	result, _ := et.Execute(context.Background(), map[string]any{
		"path": "/nonexistent/file.txt", "oldText": "a", "newText": "b",
	}, ToolContext{})
	if result.Output == "" {
		t.Error("expected error output for missing file")
	}
}
