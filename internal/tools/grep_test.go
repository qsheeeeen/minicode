package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGrepTool_Execute(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("hello world\nfoo bar\nhello again"), 0o644)

	gt := NewGrepTool()
	result, _ := gt.Execute(context.Background(), map[string]any{
		"pattern": "hello", "path": path, "recursive": false,
	}, ToolContext{})
	if !strings.Contains(result.Output, "hello world") {
		t.Errorf("expected match, got %q", result.Output)
	}
	if !strings.Contains(result.Output, "hello again") {
		t.Errorf("expected second match, got %q", result.Output)
	}
}

func TestGrepTool_NoMatches(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("hello world"), 0o644)

	gt := NewGrepTool()
	result, _ := gt.Execute(context.Background(), map[string]any{
		"pattern": "nonexistent", "path": path, "recursive": false,
	}, ToolContext{})
	if !strings.Contains(result.Output, "No matches found") {
		t.Errorf("expected 'No matches found', got %q", result.Output)
	}
}

func TestGrepTool_MissingPattern(t *testing.T) {
	gt := NewGrepTool()
	result, _ := gt.Execute(context.Background(), map[string]any{}, ToolContext{})
	if !strings.Contains(result.Output, "pattern is required") {
		t.Errorf("expected pattern error, got %q", result.Output)
	}
}

func TestGrepTool_CaseInsensitive(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("Hello World"), 0o644)

	gt := NewGrepTool()
	result, _ := gt.Execute(context.Background(), map[string]any{
		"pattern": "hello", "path": path, "recursive": false, "ignore_case": true,
	}, ToolContext{})
	if !strings.Contains(result.Output, "Hello World") {
		t.Errorf("expected case-insensitive match, got %q", result.Output)
	}
}

func TestGrepTool_IncludeFilter(t *testing.T) {
	tmp := t.TempDir()
	os.WriteFile(filepath.Join(tmp, "a.go"), []byte("package main"), 0o644)
	os.WriteFile(filepath.Join(tmp, "b.txt"), []byte("package main"), 0o644)

	gt := NewGrepTool()
	result, _ := gt.Execute(context.Background(), map[string]any{
		"pattern": "package", "path": tmp, "include": "*.go",
	}, ToolContext{})
	if strings.Contains(result.Output, "b.txt") {
		t.Errorf("expected only .go files, got %q", result.Output)
	}
}
