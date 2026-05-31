package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestRenderInputNormal(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	out := m.Input.View()
	if !strings.Contains(out, "Type a message") {
		t.Error("renderInput should contain placeholder")
	}
}

func TestRenderInputStreaming(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Input.streaming = true
	out := m.Input.View()
	if strings.Contains(out, "> Type a message") {
		t.Error("streaming input should show spinner, not arrow")
	}
}

func TestRenderInputPermission(t *testing.T) {
	m := newTestModel()
	m.Input.Perm.pending = true
	m.Input.Perm.text = "Allow Bash?"
	out := m.Input.View()
	if !strings.Contains(out, "Permission Required") {
		t.Error("permPending should show permission prompt")
	}
}

func TestRenderInputSelectMode(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Select.mode = "effort-select"
	if !m.Select.Active() {
		t.Error("selectMode should be active")
	}
}
