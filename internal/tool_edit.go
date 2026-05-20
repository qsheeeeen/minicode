package internal

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// EditTool performs exact string replacements in files.
type EditTool struct{}

// NewEditTool creates an EditTool.
func NewEditTool() *EditTool { return &EditTool{} }

func (t *EditTool) Name() string             { return "Edit" }
func (t *EditTool) Description() string      { return "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits." }
func (t *EditTool) RequiresPermission() bool { return true }

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

func (t *EditTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	filePath, _ := args["path"].(string)
	oldText, _ := args["oldText"].(string)
	newText, _ := args["newText"].(string)

	if filePath == "" {
		return ToolResult{Output: "Error: path is required"}, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return ToolResult{Output: err.Error()}, nil
	}

	content := string(data)
	if !strings.Contains(content, oldText) {
		return ToolResult{Output: "Error: oldText not found in file"}, nil
	}

	newContent := strings.Replace(content, oldText, newText, 1)
	if err := os.WriteFile(filePath, []byte(newContent), 0o644); err != nil {
		return ToolResult{Output: err.Error()}, nil
	}

	diff := diffLines(oldText, newText)
	return ToolResult{Output: fmt.Sprintf("Edited %s (%s)\n%s", filePath, diff.header, diff.body)}, nil
}

type diffRes struct {
	header string
	body   string
}

func diffLines(oldText, newText string) diffRes {
	oldLines := splitLines(oldText)
	newLines := splitLines(newText)

	removed, added := 0, 0
	var bodyLines []string

	i, j := 0, 0
	for i < len(oldLines) || j < len(newLines) {
		if i < len(oldLines) && j < len(newLines) {
			if oldLines[i] == newLines[j] {
				bodyLines = append(bodyLines, fmt.Sprintf("    %s", oldLines[i]))
				i++
				j++
			} else {
				if i < len(oldLines) {
					bodyLines = append(bodyLines, fmt.Sprintf("%4d - %s", i+1, oldLines[i]))
					removed++
					i++
				}
				if j < len(newLines) {
					bodyLines = append(bodyLines, fmt.Sprintf("%4d + %s", j+1, newLines[j]))
					added++
					j++
				}
			}
		} else if i < len(oldLines) {
			bodyLines = append(bodyLines, fmt.Sprintf("%4d - %s", i+1, oldLines[i]))
			removed++
			i++
		} else {
			bodyLines = append(bodyLines, fmt.Sprintf("%4d + %s", j+1, newLines[j]))
			added++
			j++
		}
	}

	return diffRes{
		header: fmt.Sprintf("-%d/+%d lines", removed, added),
		body:   strings.Join(bodyLines, "\n"),
	}
}
