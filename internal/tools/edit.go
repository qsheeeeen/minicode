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

func (t *EditTool) Name() string { return "Edit" }
func (t *EditTool) Description() string {
	return "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits."
}
func (t *EditTool) ReadOnly() bool    { return false }
func (t *EditTool) Interactive() bool { return false }
func (t *EditTool) Requires() []ToolRequirement { return nil }

func (t *EditTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":       map[string]any{"type": "string"},
			"oldText":    map[string]any{"type": "string"},
			"newText":    map[string]any{"type": "string"},
			"replaceAll": map[string]any{"type": "boolean", "description": "Replace all occurrences (default: false, replaces first only)"},
		},
		"required": []string{"path", "oldText", "newText"},
	}
}

func (t *EditTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	filePath, _ := args["path"].(string)
	oldText, _ := args["oldText"].(string)
	newText, _ := args["newText"].(string)
	replaceAll, _ := args["replaceAll"].(bool)

	if filePath == "" {
		tc.Log("Edit: path is required")
		return domain.ToolResult{Output: "Error: path is required"}, nil
	}

	tc.Log("Edit: editing file", "path", filePath, "old_length", len(oldText), "new_length", len(newText), "replaceAll", replaceAll)

	data, err := os.ReadFile(filePath)
	if err != nil {
		tc.LogErr("Edit: read failed", "path", filePath, "error", err)
		return domain.ToolResult{Output: err.Error()}, nil
	}

	content := string(data)
	count := strings.Count(content, oldText)
	if count == 0 {
		tc.LogErr("Edit: oldText not found", "path", filePath, "old_length", len(oldText))
		return domain.ToolResult{Output: "Error: oldText not found in file"}, nil
	}

	if !replaceAll && count > 1 {
		return domain.ToolResult{Output: fmt.Sprintf("Error: oldText found %d times. Set replaceAll=true to replace all occurrences, or make oldText more specific to match exactly once.", count)}, nil
	}

	n := 1
	if replaceAll {
		n = -1
	}
	newContent := strings.Replace(content, oldText, newText, n)
	if err := os.WriteFile(filePath, []byte(newContent), 0o644); err != nil {
		tc.LogErr("Edit: write failed", "path", filePath, "error", err)
		return domain.ToolResult{Output: err.Error()}, nil
	}

	replaced := count
	if !replaceAll {
		replaced = 1
	}
	tc.Log("Edit: file edited", "path", filePath, "old_size", len(content), "new_size", len(newContent), "replaced", replaced)

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
		Output: fmt.Sprintf("Edited %s (%d replacement(s), -%d/+%d lines)\n%s", filePath, replaced, removed, added, out.String()),
	}, nil
}

func init() { Register(NewEditTool()) }
