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
	m.Select.SetMode("test-mode", "Pick one:", items)
	if m.Select.mode != "test-mode" {
		t.Errorf("selectMode should be 'test-mode', got %q", m.Select.mode)
	}

	m.Select.ClearMode()
	if m.Select.mode != "" {
		t.Errorf("selectMode should be empty after clear, got %q", m.Select.mode)
	}
}

func TestHandleSelectChoiceEffort(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Select.mode = "effort-select"
	m.handleSelectChoice("high")
	if m.Select.mode != "" {
		t.Error("effort-select should clear mode after choice")
	}
}
