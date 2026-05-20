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
	mode  PermissionMode
	promptFn func(displayText string) string // for manual mode in TUI; nil = deny
}

// NewPermissionService creates a permission service.
func NewPermissionService(mode PermissionMode) *PermissionService {
	return &PermissionService{mode: mode}
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
func (p *PermissionService) Check(toolName, displayText string) (allowed bool, reason string) {
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
		// Auto mode requires an LLM client for gating; for now, allow read tools, deny others
		if isReadTool(toolName) {
			return true, ""
		}
		return false, fmt.Sprintf("Auto-gate denied: %s", toolName)
	}
	return false, "unknown mode"
}

func isReadTool(name string) bool {
	return strings.EqualFold(name, "Read") || strings.EqualFold(name, "Bash")
}

// Ensure PermissionService implements PermissionChecker.
var _ PermissionChecker = (*PermissionService)(nil)
