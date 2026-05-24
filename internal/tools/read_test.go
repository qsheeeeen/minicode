package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTool_Execute(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	os.WriteFile(path, []byte("file content"), 0o644)

	rt := NewReadTool()
	result, err := rt.Execute(context.Background(), map[string]any{"path": path}, ToolContext{})
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if !strings.Contains(result.Output, "file content") {
		t.Errorf("expected 'file content' in output, got %q", result.Output)
	}
}

func TestReadTool_FileNotFound(t *testing.T) {
	rt := NewReadTool()
	result, _ := rt.Execute(context.Background(), map[string]any{"path": "/nonexistent/file.txt"}, ToolContext{})
	if result.Output == "" || !strings.Contains(result.Output, "no such file") {
		t.Logf("read error output: %s", result.Output)
	}
}

func TestReadTool_OffsetLimit(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "lines.txt")
	os.WriteFile(path, []byte("line1\nline2\nline3\nline4\nline5"), 0o644)

	rt := NewReadTool()
	// offset=2 (start from line2), limit=2 = read "line2\nline3"
	result, _ := rt.Execute(context.Background(), map[string]any{"path": path, "offset": float64(2), "limit": float64(2)}, ToolContext{})
	if !strings.Contains(result.Output, "line2") || !strings.Contains(result.Output, "line3") || strings.Contains(result.Output, "line4") {
		t.Errorf("expected lines 2-3 in output, got %q", result.Output)
	}
}

func TestReadTool_OffsetWithoutLimit(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "lines.txt")
	os.WriteFile(path, []byte("line1\nline2\nline3\nline4"), 0o644)

	rt := NewReadTool()
	// offset=3 skips first 2 lines
	result, _ := rt.Execute(context.Background(), map[string]any{"path": path, "offset": float64(3)}, ToolContext{})
	if !strings.Contains(result.Output, "line3") || !strings.Contains(result.Output, "line4") || strings.Contains(result.Output, "line2") {
		t.Errorf("expected lines from offset 3, got %q", result.Output)
	}
}

func TestReadTool_LimitOnly(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "lines.txt")
	os.WriteFile(path, []byte("line1\nline2\nline3\nline4\nline5"), 0o644)

	rt := NewReadTool()
	// limit=2 lines = first 2 full lines
	result, _ := rt.Execute(context.Background(), map[string]any{"path": path, "limit": float64(2)}, ToolContext{})
	if !strings.Contains(result.Output, "line1") || !strings.Contains(result.Output, "line2") || strings.Contains(result.Output, "line3") {
		t.Errorf("expected first 2 lines, got %q", result.Output)
	}
}

func TestReadTool_MissingPath(t *testing.T) {
	rt := NewReadTool()
	result, _ := rt.Execute(context.Background(), map[string]any{}, ToolContext{})
	if !strings.Contains(result.Output, "Error") || !strings.Contains(result.Output, "path") {
		t.Errorf("expected path error, got %q", result.Output)
	}
}
