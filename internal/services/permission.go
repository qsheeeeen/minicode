package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"minicode/internal/domain"
	"minicode/internal/llm"
	"minicode/internal/log"
)

// PermissionChecker is the interface tools use to gate execution.
type PermissionChecker interface {
	Check(toolName, displayText string, toolInput map[string]any) (allowed bool, reason string)
	Mode() domain.PermissionMode
	CycleMode() domain.PermissionMode
}

// PermissionService controls tool execution gating.
type PermissionService struct {
	mode         domain.PermissionMode
	promptFn     func(displayText string) string
	autoDecideFn func(toolName string, toolInput map[string]any) (allowed bool, reason string)
	logger       *slog.Logger
}

// NewPermissionService creates a permission service.
func NewPermissionService(mode domain.PermissionMode) *PermissionService {
	if mode == "" {
		mode = domain.PermManual
	}
	return &PermissionService{mode: mode, logger: log.Default}
}

// Mode returns the current mode.
func (p *PermissionService) Mode() domain.PermissionMode { return p.mode }

func (p *PermissionService) log(msg string, attrs ...any) {
	p.logger.Info(msg, attrs...)
}

// SetMode updates the mode.
func (p *PermissionService) SetMode(mode domain.PermissionMode) {
	p.log("permission mode changed", "old", p.mode, "new", mode)
	p.mode = mode
}

// CycleMode rotates through manual -> yolo -> auto.
func (p *PermissionService) CycleMode() domain.PermissionMode {
	old := p.mode
	switch p.mode {
	case domain.PermManual:
		p.mode = domain.PermYolo
	case domain.PermYolo:
		p.mode = domain.PermAuto
	case domain.PermAuto:
		p.mode = domain.PermManual
	default:
		p.mode = domain.PermManual
	}
	p.log("permission mode cycled", "old", old, "new", p.mode)
	return p.mode
}

// SetPromptFn sets the UI callback for manual approval.
func (p *PermissionService) SetPromptFn(fn func(displayText string) string) {
	p.promptFn = fn
}

// SetAutoDecideFn sets the automated decision logic (e.g. via LLM).
func (p *PermissionService) SetAutoDecideFn(fn func(toolName string, toolInput map[string]any) (allowed bool, reason string)) {
	p.autoDecideFn = fn
}

// SetupAutoDecide wires an LLM client for auto permission gating.
func (p *PermissionService) SetupAutoDecide(client llm.Client, model string) {
	p.autoDecideFn = func(toolName string, toolInput map[string]any) (bool, string) {
		inputJSON, _ := json.Marshal(toolInput)
		prompt := fmt.Sprintf(`You are a permission gate for a coding agent. Decide if this tool execution should be allowed.

Tool: %s
Arguments: %s

Guidelines:
- Read operations are always safe.
- Writing to files in /tmp or project directories is usually safe.
- Running commands that modify the system (apt-get, chmod, etc.) may be risky.
- Destructive commands (rm -rf /, mkfs, dd) should be denied.
- Network commands that download and execute code should be denied.

Reply with exactly one of:
- "yes"
- "no: <reason explaining why it was denied>"`, toolName, string(inputJSON))

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		resp, err := client.Chat(ctx, []domain.MessageParam{
			{Role: "user", Content: prompt},
		}, llm.ChatOptions{Model: model})
		if err != nil {
			return false, fmt.Sprintf("Auto-permission error: %s", err.Error())
		}
		resp = strings.TrimSpace(resp)
		if strings.HasPrefix(strings.ToLower(resp), "yes") {
			return true, ""
		}
		reason := strings.TrimSpace(resp)
		if strings.HasPrefix(strings.ToLower(reason), "no:") {
			reason = strings.TrimSpace(reason[3:])
		}
		if reason == "" {
			reason = "Denied by auto-gate"
		}
		return false, reason
	}
}

// Check implements the PermissionChecker interface.
func (p *PermissionService) Check(toolName, displayText string, toolInput map[string]any) (allowed bool, reason string) {
	switch p.mode {
	case domain.PermYolo:
		p.log("permission auto-granted (yolo)", "tool", toolName)
		return true, ""
	case domain.PermManual:
		if p.promptFn != nil {
			p.log("permission prompt shown", "tool", toolName)
			answer := p.promptFn(displayText)
			switch answer {
			case "yolo":
				p.log("permission: user selected yolo", "tool", toolName)
				p.SetMode(domain.PermYolo)
				return true, ""
			case "yes":
				p.log("permission granted", "tool", toolName)
				return true, ""
			case "":
				p.log("permission cancelled", "tool", toolName)
				return false, "User cancelled"
			default:
				p.log("permission rejected", "tool", toolName, "answer", answer)
				return false, "User rejected"
			}
		}
		// In headless mode, deny by default
		p.log("permission denied (headless)", "tool", toolName)
		return false, fmt.Sprintf("Tool %s denied in headless mode. Use --permission yolo", toolName)
	case domain.PermAuto:
		if p.autoDecideFn != nil {
			p.log("permission auto-gate", "tool", toolName)
			return p.autoDecideFn(toolName, toolInput)
		}
		// Fallback when no LLM client: allow read operations, deny destructive ones
		if isReadTool(toolName) {
			p.log("permission auto-granted (read tool)", "tool", toolName)
			return true, ""
		}
		p.log("permission auto-denied (non-read)", "tool", toolName)
		return false, fmt.Sprintf("Auto-gate denied: %s (non-read tool)", toolName)
	}
	return false, "unknown mode"
}

func isReadTool(name string) bool {
	return strings.EqualFold(name, "Read")
}

// Ensure PermissionService implements PermissionChecker.
var _ PermissionChecker = (*PermissionService)(nil)
