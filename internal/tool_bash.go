package internal

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// BashTool executes shell commands.
type BashTool struct{}

// NewBashTool creates a BashTool.
func NewBashTool() *BashTool { return &BashTool{} }

func (t *BashTool) Name() string             { return "Bash" }
func (t *BashTool) Description() string      { return "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds." }
func (t *BashTool) RequiresPermission() bool    { return true }
func (t *BashTool) Requires() []ToolRequirement { return nil }

func (t *BashTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command": map[string]any{"type": "string"},
			"timeout": map[string]any{"type": "number"},
		},
		"required": []string{"command"},
	}
}

var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripANSI(s string) string { return ansiRegex.ReplaceAllString(s, "") }

func (t *BashTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	command, _ := args["command"].(string)
	if command == "" {
		return ToolResult{Output: "Error: command is required"}, nil
	}

	timeoutSec := 120.0
	if t, ok := args["timeout"].(float64); ok && t > 0 {
		timeoutSec = t
	}

	execCtx := ctx
	if timeoutSec > 0 {
		var cancel context.CancelFunc
		execCtx, cancel = context.WithTimeout(ctx, time.Duration(timeoutSec*float64(time.Second)))
		defer cancel()
	}

	cmd := exec.CommandContext(execCtx, "bash", "-c", command)
	stdout, err := cmd.Output()
	if err != nil {
		if execCtx.Err() == context.DeadlineExceeded {
			return ToolResult{Output: "Error: command timed out"}, nil
		}
		if execCtx.Err() == context.Canceled {
			return ToolResult{Output: "Aborted"}, nil
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr := strings.TrimSpace(stripANSI(string(exitErr.Stderr)))
			stdoutStr := strings.TrimSpace(stripANSI(string(stdout)))
			combined := stdoutStr
			if stderr != "" {
				if combined != "" {
					combined += "\n" + stderr
				} else {
					combined = stderr
				}
			}
			code := exitErr.ExitCode()
			return ToolResult{Output: fmt.Sprintf("Exit code %d: %s", code, combined)}, nil
		}
		return ToolResult{Output: err.Error()}, nil
	}
	return ToolResult{Output: strings.TrimSpace(stripANSI(string(stdout)))}, nil
}
