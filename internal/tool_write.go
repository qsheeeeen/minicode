package internal

import (
	"context"
	"os"
	"path/filepath"
)

// WriteTool writes content to files.
type WriteTool struct{}

// NewWriteTool creates a WriteTool.
func NewWriteTool() *WriteTool { return &WriteTool{} }

func (t *WriteTool) Name() string             { return "Write" }
func (t *WriteTool) Description() string      { return "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories." }
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

func (t *WriteTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	filePath, _ := args["path"].(string)
	content, _ := args["content"].(string)

	if filePath == "" {
		return ToolResult{Output: "Error: path is required"}, nil
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return ToolResult{Output: err.Error()}, nil
	}

	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		return ToolResult{Output: err.Error()}, nil
	}

	return ToolResult{Output: "Wrote " + filePath}, nil
}
