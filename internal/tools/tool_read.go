package tools

import (
	"context"
	"fmt"
	"io"
	"os"

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

	file, err := os.Open(path)
	if err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	offset := 0
	if v, ok := args["offset"].(float64); ok {
		offset = int(v)
	}
	limit := 50000 // default 50k chars
	if v, ok := args["limit"].(float64); ok {
		limit = int(v)
	}

	if offset > int(stat.Size()) {
		return domain.ToolResult{Output: fmt.Sprintf("Error: offset %d is beyond file size %d", offset, stat.Size())}, nil
	}

	if _, err := file.Seek(int64(offset), io.SeekStart); err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	buf := make([]byte, limit)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	content := string(buf[:n])
	res := fmt.Sprintf("Content of %s (offset %d, %d bytes read):\n---\n%s\n---", path, offset, n, content)
	if offset+n < int(stat.Size()) {
		res += fmt.Sprintf("\n(Note: File has %d more bytes. Use offset %d to read more.)", int(stat.Size())-(offset+n), offset+n)
	}
	return domain.ToolResult{Output: res}, nil
}
