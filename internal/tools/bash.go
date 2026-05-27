package tools

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"minicode/internal/domain"
)

// BashTool executes shell commands.
type BashTool struct{}

// NewBashTool creates a BashTool.
func NewBashTool() *BashTool { return &BashTool{} }

func (t *BashTool) Name() string { return "Bash" }
func (t *BashTool) Description() string {
	return "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds."
}
func (t *BashTool) ReadOnly() bool    { return false }
func (t *BashTool) Interactive() bool { return false }
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

func (t *BashTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	command, _ := args["command"].(string)
	if command == "" {
		tc.Log("Bash: command is required")
		return domain.ToolResult{Output: "Error: command is required"}, nil
	}

	timeoutSec := 120.0
	if t, ok := args["timeout"].(float64); ok && t > 0 {
		timeoutSec = t
	}

	tc.Log("Bash: executing command", "command", command, "timeout", timeoutSec)

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
			tc.LogErr("Bash: command timed out", "command", command, "timeout", timeoutSec)
			return domain.ToolResult{Output: "Error: command timed out"}, nil
		}
		if execCtx.Err() == context.Canceled {
			tc.Log("Bash: command aborted", "command", command)
			return domain.ToolResult{Output: "Aborted"}, nil
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
			tc.LogErr("Bash: command exited with error", "command", command, "exit_code", code, "output_length", len(combined))
			return domain.ToolResult{Output: fmt.Sprintf("Exit code %d: %s", code, combined)}, nil
		}
		tc.LogErr("Bash: command failed", "command", command, "error", err)
		return domain.ToolResult{Output: err.Error()}, nil
	}

	output := strings.TrimSpace(stripANSI(string(stdout)))
	tc.Log("Bash: command completed", "command", command, "output_length", len(output))
	return domain.ToolResult{Output: output}, nil
}

func stripANSI(str string) string {
	var re = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
	return re.ReplaceAllString(str, "")
}

func init() { Register(NewBashTool()) }
