package internal

import (
	"fmt"
	"strings"
)

// PermissionMode defines how tool execution is gated.
type PermissionMode string

const (
	PermManual PermissionMode = "manual"
	PermYolo   PermissionMode = "yolo"
	PermAuto   PermissionMode = "auto"
)

var permCycle = []PermissionMode{PermManual, PermYolo, PermAuto}

// PermissionService controls tool execution gating.
type PermissionService struct {
	mode         PermissionMode
	promptFn     func(displayText string) string // for manual mode in TUI; nil = deny
	autoDecideFn func(toolName string, toolInput map[string]any) (allowed bool, reason string) // LLM-based gating
}

// NewPermissionService creates a permission service.
func NewPermissionService(mode PermissionMode) *PermissionService {
	return &PermissionService{mode: mode}
}

// SetAutoDecide sets the LLM-based auto-decide function.
func (p *PermissionService) SetAutoDecide(fn func(toolName string, toolInput map[string]any) (allowed bool, reason string)) {
	p.autoDecideFn = fn
}

// Mode returns the current permission mode.
func (p *PermissionService) Mode() PermissionMode { return p.mode }

// SetMode updates the permission mode.
func (p *PermissionService) SetMode(mode PermissionMode) { p.mode = mode }

// CycleMode rotates through manual → yolo → auto → manual.
func (p *PermissionService) CycleMode() PermissionMode {
	for i, m := range permCycle {
		if m == p.mode {
			p.mode = permCycle[(i+1)%len(permCycle)]
			break
		}
	}
	return p.mode
}

// SetPromptFn sets the interactive prompt function (for TUI use).
func (p *PermissionService) SetPromptFn(fn func(displayText string) string) {
	p.promptFn = fn
}

// Check implements the PermissionChecker interface.
func (p *PermissionService) Check(toolName, displayText string, toolInput map[string]any) (allowed bool, reason string) {
	switch p.mode {
	case PermYolo:
		return true, ""
	case PermManual:
		if p.promptFn != nil {
			answer := p.promptFn(displayText)
			switch answer {
			case "yolo":
				p.SetMode(PermYolo)
				return true, ""
			case "yes":
				return true, ""
			case "":
				return false, "User cancelled"
			default:
				return false, "User rejected"
			}
		}
		// In headless mode, deny by default
		return false, fmt.Sprintf("Tool %s denied in headless mode. Use --permission yolo", toolName)
	case PermAuto:
		if p.autoDecideFn != nil {
			return p.autoDecideFn(toolName, toolInput)
		}
		// Fallback when no LLM client: allow read operations, deny destructive ones
		if isReadTool(toolName) {
			return true, ""
		}
		return false, fmt.Sprintf("Auto-gate denied: %s (non-read tool)", toolName)
	}
	return false, "unknown mode"
}

func isReadTool(name string) bool {
	return strings.EqualFold(name, "Read")
}

// Ensure PermissionService implements PermissionChecker.
var _ PermissionChecker = (*PermissionService)(nil)
