package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestRenderHeader(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	h := m.Header.View(m.width)
	if !strings.Contains(h, "Mini Code") {
		t.Error("renderHeader should contain 'Mini Code'")
	}
	if !strings.Contains(h, Version) {
		t.Error("renderHeader should contain version")
	}
}

func TestRenderHeaderWithPromptFiles(t *testing.T) {
	m := newTestModel()
	m.Header.promptFiles = []string{"AGENTS.md", "CLAUDE.md"}
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	h := m.Header.View(m.width)
	if !strings.Contains(h, "AGENTS.md") {
		t.Error("renderHeader should show prompt files")
	}
}
