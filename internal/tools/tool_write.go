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

func (t *WriteTool) Name() string             { return "Write" }
func (t *WriteTool) Description() string      { return "Create a new file or completely rewrite an existing file with the provided content. For modifying existing files, prefer the Edit tool." }
func (t *WriteTool) RequiresPermission() bool    { return true }
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
		return domain.ToolResult{Output: "Error: path is required"}, nil
	}

	// Create parent directories if missing
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	return domain.ToolResult{Output: fmt.Sprintf("Successfully wrote %d bytes to %s", len(content), path)}, nil
}
