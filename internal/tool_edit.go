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

type diffResult struct {
	header string
	body   string
}

func diffLines(oldText, newText string) diffResult {
	oldLines := splitLines(oldText)
	newLines := splitLines(newText)

	// Build LCS diff hunks
	type hunkLine struct {
		kind    rune // ' ' context, '-' removed, '+' added
		oldNum  int
		newNum  int
		content string
	}

	// Simple longest common subsequence based diff
	var result []hunkLine
	i, j := 0, 0
	for i < len(oldLines) || j < len(newLines) {
		if i < len(oldLines) && j < len(newLines) && oldLines[i] == newLines[j] {
			result = append(result, hunkLine{' ', i + 1, j + 1, oldLines[i]})
			i++
			j++
		} else if i < len(oldLines) && j < len(newLines) {
			// Changed line
			result = append(result, hunkLine{'-', i + 1, 0, oldLines[i]})
			result = append(result, hunkLine{'+', 0, j + 1, newLines[j]})
			i++
			j++
		} else if i < len(oldLines) {
			result = append(result, hunkLine{'-', i + 1, 0, oldLines[i]})
			i++
		} else {
			result = append(result, hunkLine{'+', 0, j + 1, newLines[j]})
			j++
		}
	}

	// Format with context (show 3 context lines around changes)
	removed, added := 0, 0
	var bodyLines []string
	lastPrinted := -4 // ensure separator before first hunk

	for idx := 0; idx < len(result); idx++ {
		line := result[idx]
		if line.kind == ' ' {
			// Check if this context line is within 3 lines of a change
			show := false
			for d := -3; d <= 3; d++ {
				if idx+d >= 0 && idx+d < len(result) && result[idx+d].kind != ' ' {
					show = true
					break
				}
			}
			if !show {
				continue
			}
			if idx-lastPrinted > 4 {
				bodyLines = append(bodyLines, "...")
			}
		}

		switch line.kind {
		case ' ':
			bodyLines = append(bodyLines, fmt.Sprintf("%4d   %s", line.newNum, line.content))
		case '-':
			bodyLines = append(bodyLines, fmt.Sprintf("%4d - %s", line.oldNum, line.content))
			removed++
		case '+':
			bodyLines = append(bodyLines, fmt.Sprintf("%4d + %s", line.newNum, line.content))
			added++
		}
		lastPrinted = idx
	}

	return diffResult{
		header: fmt.Sprintf("-%d/+%d lines", removed, added),
		body:   strings.Join(bodyLines, "\n"),
	}
}
