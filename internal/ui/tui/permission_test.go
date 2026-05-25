package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestPermissionPromptView(t *testing.T) {
	var p PermissionPrompt
	p.Activate("Bash(ls)", make(chan string, 1))
	if !p.IsActive() {
		t.Error("should be active after Activate")
	}
	v := p.View(100)
	if !strings.Contains(v, "Permission Required") {
		t.Error("should show 'Permission Required' title")
	}
	if !strings.Contains(v, "Bash(ls)") {
		t.Error("should show the tool being checked")
	}
}

func TestPermissionPromptResolve(t *testing.T) {
	var p PermissionPrompt
	ch := make(chan string, 1)
	p.Activate("test tool", ch)

	// Navigate to first option (yes) and press Enter
	p.list.Select(0)
	handled := p.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if !handled {
		t.Error("Enter should be handled")
	}
	if p.IsActive() {
		t.Error("should not be active after resolution")
	}

	select {
	case res := <-ch:
		if res != "yes" {
			t.Errorf("expected 'yes', got %q", res)
		}
	default:
		t.Error("should have sent result to channel")
	}
}
