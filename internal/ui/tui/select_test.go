package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	icmd "minicode/internal/commands"
)

func TestSetModeAndClear(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	items := []icmd.SelectItem{
		{Value: "a", Label: "Option A"},
		{Value: "b", Label: "Option B", Description: "desc"},
	}
	m.setMode("test-mode", "Pick one:", items)
	if m.selectMode != "test-mode" {
		t.Errorf("selectMode should be 'test-mode', got %q", m.selectMode)
	}

	m.clearMode()
	if m.selectMode != "" {
		t.Errorf("selectMode should be empty after clear, got %q", m.selectMode)
	}
}

func TestHandleSelectChoiceEffort(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.selectMode = "effort-select"
	m.handleSelectChoice("high")
	if m.selectMode != "" {
		t.Error("effort-select should clear mode after choice")
	}
}
