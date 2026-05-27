package tools

import (
	"context"
	"os/exec"
	"strings"

	"minicode/internal/domain"
)

// GrepTool wraps the system grep command.
type GrepTool struct{}

// NewGrepTool creates a GrepTool.
func NewGrepTool() *GrepTool { return &GrepTool{} }

func (t *GrepTool) Name() string { return "Grep" }
func (t *GrepTool) Description() string {
	return "Search file contents using the system grep command. Supports recursive search, line numbers, and case-insensitive matching. Searches are restricted to the current working directory and its subdirectories."
}
func (t *GrepTool) ReadOnly() bool    { return true }
func (t *GrepTool) Interactive() bool { return false }
func (t *GrepTool) Requires() []ToolRequirement { return nil }

func (t *GrepTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"pattern":     map[string]any{"type": "string", "description": "The regex pattern to search for"},
			"path":        map[string]any{"type": "string", "description": "Directory or file to search in (default: current directory)"},
			"recursive":   map[string]any{"type": "boolean", "description": "Search recursively in subdirectories (default: true)"},
			"ignore_case": map[string]any{"type": "boolean", "description": "Case-insensitive search"},
			"include":     map[string]any{"type": "string", "description": "File glob pattern to include, e.g. '*.go'"},
		},
		"required": []string{"pattern"},
	}
}

func (t *GrepTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	pattern, _ := args["pattern"].(string)
	if pattern == "" {
		return domain.ToolResult{Output: "Error: pattern is required"}, nil
	}

	path, _ := args["path"].(string)
	if path == "" {
		path = "."
	}

	recursive := true
	if r, ok := args["recursive"].(bool); ok {
		recursive = r
	}

	ignoreCase := false
	if i, ok := args["ignore_case"].(bool); ok {
		ignoreCase = i
	}

	include, _ := args["include"].(string)

	grepArgs := []string{"-n"}
	if ignoreCase {
		grepArgs = append(grepArgs, "-i")
	}
	if recursive {
		grepArgs = append(grepArgs, "-r")
	}
	if include != "" {
		grepArgs = append(grepArgs, "--include="+include)
	}
	grepArgs = append(grepArgs, pattern, path)

	tc.Log("Grep: executing", "pattern", pattern, "path", path, "recursive", recursive, "ignore_case", ignoreCase)

	cmd := exec.CommandContext(ctx, "grep", grepArgs...)
	output, err := cmd.CombinedOutput()

	outputStr := strings.TrimSpace(string(output))
	if err != nil {
		if ctx.Err() == context.Canceled {
			return domain.ToolResult{Output: "Aborted"}, nil
		}
		if outputStr == "" {
			return domain.ToolResult{Output: "No matches found"}, nil
		}
		return domain.ToolResult{Output: outputStr}, nil
	}

	tc.Log("Grep: completed", "matches", strings.Count(outputStr, "\n")+1)
	return domain.ToolResult{Output: outputStr}, nil
}

func init() { Register(NewGrepTool()) }
