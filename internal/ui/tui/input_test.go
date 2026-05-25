package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestRenderInputNormal(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	in := m.renderInput()
	if !strings.Contains(in, "Type a message") {
		t.Error("renderInput should contain placeholder")
	}
	if !strings.Contains(in, ">") {
		t.Error("renderInput should contain arrow prompt")
	}
}

func TestRenderInputStreaming(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.streaming = true
	in := m.renderInput()
	if strings.Contains(in, "> Type a message") {
		t.Error("streaming input should show spinner, not arrow")
	}
}

func TestRenderInputPermission(t *testing.T) {
	m := newTestModel()
	m.permPending = true
	m.permText = "Allow Bash?"
	in := m.renderInput()
	if !strings.Contains(in, "[Permission]") {
		t.Error("permPending should show permission prompt")
	}
}

func TestRenderInputSelectMode(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.selectMode = "effort-select"
	in := m.renderInput()
	if strings.Contains(in, "Type a message") {
		t.Error("selectMode should replace input with list view")
	}
}
