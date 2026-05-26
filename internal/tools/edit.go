package tools

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/sergi/go-diff/diffmatchpatch"
	"minicode/internal/domain"
)

// EditTool performs exact string replacements in files.
type EditTool struct{}

// NewEditTool creates an EditTool.
func NewEditTool() *EditTool { return &EditTool{} }

func (t *EditTool) Name() string             { return "Edit" }
func (t *EditTool) Description() string      { return "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits." }
func (t *EditTool) RequiresPermission() bool    { return true }
func (t *EditTool) Requires() []ToolRequirement { return nil }

func (t *EditTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":    map[string]any{"type": "string"},
			"oldText": map[string]any{"type": "string"},
			"newText": map[string]any{"type": "string"},
		},
		"required": []string{"path", "oldText", "newText"},
	}
}

func (t *EditTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	filePath, _ := args["path"].(string)
	oldText, _ := args["oldText"].(string)
	newText, _ := args["newText"].(string)

	if filePath == "" {
		return domain.ToolResult{Output: "Error: path is required"}, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	content := string(data)
	if !strings.Contains(content, oldText) {
		return domain.ToolResult{Output: "Error: oldText not found in file"}, nil
	}

	newContent := strings.Replace(content, oldText, newText, 1)
	if err := os.WriteFile(filePath, []byte(newContent), 0o644); err != nil {
		return domain.ToolResult{Output: err.Error()}, nil
	}

	dmp := diffmatchpatch.New()
	diffs := dmp.DiffMain(oldText, newText, false)
	
	var out strings.Builder
	removed, added := 0, 0
	
	// Convert to line-based diff for better LLM/UI readability
	for _, d := range diffs {
		lines := strings.Split(d.Text, "\n")
		for i, line := range lines {
			if i == len(lines)-1 && line == "" && d.Text != "" {
				continue
			}
			switch d.Type {
			case diffmatchpatch.DiffDelete:
				out.WriteString(" - " + line + "\n")
				removed++
			case diffmatchpatch.DiffInsert:
				out.WriteString(" + " + line + "\n")
				added++
			case diffmatchpatch.DiffEqual:
				// Only show context if it's small, otherwise truncate
				if len(lines) < 10 {
					out.WriteString("   " + line + "\n")
				} else if i < 3 || i >= len(lines)-3 {
					out.WriteString("   " + line + "\n")
				} else if i == 3 {
					out.WriteString("   ...\n")
				}
			}
		}
	}

	return domain.ToolResult{
		Output: fmt.Sprintf("Edited %s (-%d/+%d lines)\n%s", filePath, removed, added, out.String()),
	}, nil
}

func init() { Register(NewEditTool()) }
