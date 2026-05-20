package internal

import (
	"context"
	"os"
)

// ReadTool reads files from the local filesystem.
type ReadTool struct{}

// NewReadTool creates a ReadTool.
func NewReadTool() *ReadTool { return &ReadTool{} }

func (t *ReadTool) Name() string             { return "Read" }
func (t *ReadTool) Description() string      { return "Read the contents of a file. Supports text files. Defaults to first 2000 lines. Use offset/limit for large files." }
func (t *ReadTool) RequiresPermission() bool { return false }

func (t *ReadTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":   map[string]any{"type": "string", "description": "Path to the file"},
			"offset": map[string]any{"type": "number", "description": "Line number to start from (1-indexed)"},
			"limit":  map[string]any{"type": "number", "description": "Maximum number of lines to read"},
		},
		"required": []string{"path"},
	}
}

func (t *ReadTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	path, _ := args["path"].(string)
	if path == "" {
		return ToolResult{Output: "Error: path is required"}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return ToolResult{Output: err.Error()}, nil
	}

	lines := splitLines(string(data))

	offset := 1
	if o, ok := args["offset"].(float64); ok {
		offset = int(o)
	}
	if offset < 1 {
		offset = 1
	}

	limit := len(lines)
	if l, ok := args["limit"].(float64); ok {
		limit = int(l)
	}

	start := offset - 1
	if start > len(lines) {
		start = len(lines)
	}
	end := start + limit
	if end > len(lines) {
		end = len(lines)
	}

	return ToolResult{Output: joinLines(lines[start:end])}, nil
}

func splitLines(s string) []string {
	if s == "" {
		return []string{}
	}
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func joinLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	result := lines[0]
	for i := 1; i < len(lines); i++ {
		result += "\n" + lines[i]
	}
	return result
}
