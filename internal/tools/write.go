package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"minicode/internal/domain"
)

// WriteTool creates or rewrites a file.
type WriteTool struct{}

// NewWriteTool creates a WriteTool.
func NewWriteTool() *WriteTool { return &WriteTool{} }

func (t *WriteTool) Name() string { return "Write" }
func (t *WriteTool) Description() string {
	return "Create a new file or completely rewrite an existing file with the provided content. For modifying existing files, prefer the Edit tool."
}
func (t *WriteTool) ReadOnly() bool    { return false }
func (t *WriteTool) Interactive() bool { return false }
func (t *WriteTool) Requires() []ToolRequirement { return nil }

func (t *WriteTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":    map[string]any{"type": "string"},
			"content": map[string]any{"type": "string"},
		},
		"required": []string{"path", "content"},
	}
}

func (t *WriteTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	path, _ := args["path"].(string)
	content, _ := args["content"].(string)

	if path == "" {
		tc.Log("Write: path is required")
		return domain.ToolResult{Output: "Error: path is required"}, nil
	}

	tc.Log("Write: writing file", "path", path, "content_length", len(content))

	// Create parent directories if missing
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		tc.LogErr("Write: mkdir failed", "path", path, "error", err)
		return domain.ToolResult{Output: err.Error()}, nil
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		tc.LogErr("Write: write failed", "path", path, "error", err)
		return domain.ToolResult{Output: err.Error()}, nil
	}

	tc.Log("Write: file written", "path", path, "bytes", len(content))
	return domain.ToolResult{Output: fmt.Sprintf("Wrote %s", path)}, nil
}

func init() { Register(NewWriteTool()) }
