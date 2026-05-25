package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestPermissionPrompt(t *testing.T) {
	m := newTestModel()
	m.Input.Perm.pending = true
	m.Input.Perm.text = "Allow Bash?"
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	if m.Input.Perm.pending {
		t.Error("perm should resolve after 'y'")
	}
}
