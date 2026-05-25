package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestViewBeforeReady(t *testing.T) {
	m := newTestModel()
	if !strings.Contains(m.View(), "Initializing") {
		t.Error("View before ready should show Initializing")
	}
}

func TestViewAfterReady(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := m.View()
	if !strings.Contains(view, "test-model") {
		t.Errorf("View should contain model name, got: %s", view)
	}
	if !strings.Contains(view, "Mini Code") {
		t.Error("View should contain 'Mini Code' header")
	}
	if !strings.Contains(view, "Type a message") {
		t.Error("View should contain input placeholder")
	}
}
