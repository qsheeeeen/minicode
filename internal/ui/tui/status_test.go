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

func TestRenderStatusBar(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	s := m.renderStatusBar()
	if !strings.Contains(s, "test-model") {
		t.Error("status bar should contain model name")
	}
	if !strings.Contains(s, "manual") {
		t.Error("status bar should contain permission mode")
	}
	if !strings.Contains(s, "Shift+Tab") {
		t.Error("status bar should contain Shift+Tab hint")
	}
}

func TestRenderStatusBarStreaming(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.streaming = true
	s := m.renderStatusBar()
	if !strings.Contains(s, "streaming") {
		t.Error("status bar should show 'streaming' when active")
	}
}

func TestRenderStatusBarError(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.err = errors.New("test error")
	s := m.renderStatusBar()
	if !strings.Contains(s, "ERR") {
		t.Error("status bar should show ERR when error is set")
	}
}
