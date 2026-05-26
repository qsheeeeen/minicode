package tools

import (
	"context"
	"os"
	"strings"

	"minicode/internal/domain"
)

// ReadTool reads file content.
type ReadTool struct{}

// NewReadTool creates a ReadTool.
func NewReadTool() *ReadTool { return &ReadTool{} }

func (t *ReadTool) Name() string        { return "Read" }
func (t *ReadTool) Description() string { return "Read the content of a file. Returns the file content. For large files, use offset and limit to read in chunks." }
func (t *ReadTool) RequiresPermission() bool { return false }
func (t *ReadTool) Requires() []ToolRequirement { return nil }

func (t *ReadTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":   map[string]any{"type": "string"},
			"offset": map[string]any{"type": "integer"},
			"limit":  map[string]any{"type": "integer"},
		},
		"required": []string{"path"},
	}
}

func (t *ReadTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	path, _ := args["path"].(string)
	if path == "" {
		return domain.ToolResult{Output: "Error: path is required"}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	start := 0
	if offset, ok := args["offset"].(float64); ok && offset > 0 {
		start = int(offset) - 1
	}

	end := len(lines)
	if limit, ok := args["limit"].(float64); ok {
		end = start + int(limit)
	}

	if start < 0 {
		start = 0
	}
	if start > len(lines) {
		start = len(lines)
	}
	if end < start {
		end = start
	}
	if end > len(lines) {
		end = len(lines)
	}

	result := strings.Join(lines[start:end], "\n")
	return domain.ToolResult{Output: result}, nil
}
func init() { Register(NewReadTool()) }
