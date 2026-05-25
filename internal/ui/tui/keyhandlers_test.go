package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestPermissionPrompt(t *testing.T) {
	m := newTestModel()
	m.Input.permPending = true
	m.Input.permText = "Allow Bash?"
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	if m.Input.permPending {
		t.Error("perm should resolve after 'y'")
	}
}
