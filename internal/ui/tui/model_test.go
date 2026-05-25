package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/agent"
	icmd "minicode/internal/commands"
	"minicode/internal/domain"
)

func newTestModel() *TUIModel {
	cfg := domain.AgentConfig{APIKey: "test", Model: "test-model", ContextLength: 100000}
	ag := agent.NewAgent(cfg)
	return NewTUIModel(ag, icmd.NewRegistry(), nil)
}

func TestInit(t *testing.T) {
	m := newTestModel()
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return textarea.Blink command")
	}
}

func TestWindowSize(t *testing.T) {
	m := newTestModel()
	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !m.ready {
		t.Error("model should be ready after WindowSizeMsg")
	}
}

func TestCtrlCQuits(t *testing.T) {
	m := newTestModel()
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Error("Ctrl+C should return quit command")
	}
}
