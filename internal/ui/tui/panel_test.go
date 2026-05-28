package tui

import (
	"errors"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestFormatNumber(t *testing.T) {
	tests := []struct {
		in  int
		out string
	}{
		{0, "0"},
		{100, "100"},
		{1000, "1,000"},
		{1000000, "1,000,000"},
	}
	for _, tt := range tests {
		got := formatNumber(tt.in)
		if got != tt.out {
			t.Errorf("formatNumber(%d) = %q, want %q", tt.in, got, tt.out)
		}
	}
}

func TestRenderPanel(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	s := m.Panel.View(m.agent)
	if !strings.Contains(s, "test-model") {
		t.Error("panel should contain model name")
	}
	if !strings.Contains(s, "manual") {
		t.Error("panel should contain permission mode")
	}
	if !strings.Contains(s, "unknown") {
		t.Error("panel should contain provider name")
	}
}

func TestRenderPanelStreaming(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Input.streaming = true
	m.Panel.streaming = true
	s := m.Panel.View(m.agent)
	if !strings.Contains(s, "streaming") {
		t.Error("panel should show 'streaming' when active")
	}
}

func TestRenderPanelError(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Panel.err = errors.New("test error")
	s := m.Panel.View(m.agent)
	if !strings.Contains(s, "ERR") {
		t.Error("panel should show ERR when error is set")
	}
}
