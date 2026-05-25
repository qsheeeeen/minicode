package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestPermissionPrompt(t *testing.T) {
	m := newTestModel()
	m.permPending = true
	m.permText = "Allow Bash?"
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	if m.permPending {
		t.Error("perm should resolve after 'y'")
	}
}
