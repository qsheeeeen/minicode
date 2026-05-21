package tools

import (
	"fmt"
	"strings"

	"minicode/internal/domain"
)

// PermissionService controls tool execution gating.
type PermissionService struct {
	mode         domain.PermissionMode
	promptFn     func(displayText string) string
	autoDecideFn func(toolName string, toolInput map[string]any) (allowed bool, reason string)
}

// NewPermissionService creates a permission service.
func NewPermissionService(mode domain.PermissionMode) *PermissionService {
	if mode == "" {
		mode = domain.PermManual
	}
	return &PermissionService{mode: mode}
}

// Mode returns the current mode.
func (p *PermissionService) Mode() domain.PermissionMode { return p.mode }

// SetMode updates the mode.
func (p *PermissionService) SetMode(mode domain.PermissionMode) { p.mode = mode }

// CycleMode rotates through manual -> yolo -> auto.
func (p *PermissionService) CycleMode() domain.PermissionMode {
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

// Check implements the PermissionChecker interface.
func (p *PermissionService) Check(toolName, displayText string, toolInput map[string]any) (allowed bool, reason string) {
	switch p.mode {
	case domain.PermYolo:
		return true, ""
	case domain.PermManual:
		if p.promptFn != nil {
			answer := p.promptFn(displayText)
			switch answer {
			case "yolo":
				p.SetMode(domain.PermYolo)
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
	case domain.PermAuto:
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
