package tools

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

func (t *EditTool) Name() string              { return "Edit" }
func (t *EditTool) Description() string       { return "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits." }
func (t *EditTool) RequiresPermission() bool  { return true }

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

func (t *EditTool) Execute(ctx context.Context, args map[string]any, tc Context) (Result, error) {
	filePath, _ := args["path"].(string)
	oldText, _ := args["oldText"].(string)
	newText, _ := args["newText"].(string)

	if filePath == "" {
		return Result{Output: "Error: path is required"}, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return Result{Output: err.Error()}, nil
	}

	content := string(data)
	if !strings.Contains(content, oldText) {
		return Result{Output: "Error: oldText not found in file"}, nil
	}

	newContent := strings.Replace(content, oldText, newText, 1)
	if err := os.WriteFile(filePath, []byte(newContent), 0o644); err != nil {
		return Result{Output: err.Error()}, nil
	}

	diff := generateDiff(oldText, newText)
	return Result{Output: fmt.Sprintf("Edited %s (%s)\n%s", filePath, diff.header, diff.body)}, nil
}

type diffResult struct {
	header string
	body   string
}

func generateDiff(oldText, newText string) diffResult {
	oldLines := splitLines(oldText)
	newLines := splitLines(newText)

	removed, added := 0, 0
	var bodyLines []string

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	// Simple line-by-line comparison
	i, j := 0, 0
	for i < len(oldLines) || j < len(newLines) {
		if i < len(oldLines) && j < len(newLines) {
			if oldLines[i] == newLines[j] {
				bodyLines = append(bodyLines, fmt.Sprintf("    %s", oldLines[i]))
				i++
				j++
			} else {
				// Check if line was removed (exists in old but not matching in new)
				if i < len(oldLines) {
					bodyLines = append(bodyLines, fmt.Sprintf("%4d - %s", i+1, oldLines[i]))
					removed++
					i++
				}
				// Check if line was added (exists in new but not matching in old)
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

	return diffResult{
		header: fmt.Sprintf("-%d/+%d lines", removed, added),
		body:   strings.Join(bodyLines, "\n"),
	}
}
