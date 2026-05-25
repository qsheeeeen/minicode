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
	reg := agent.NewAgentRegistry(ag)
	return NewTUIModel(ag, reg, icmd.NewRegistry(), nil)
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

func TestAgentSwitch(t *testing.T) {
	ag1 := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag2 := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m2", ContextLength: 100})
	ag2.SetSession("session-2")
	reg := agent.NewAgentRegistry(ag1)
	reg.Register("2", ag2, "test task", "1")

	m := NewTUIModel(ag1, reg, icmd.NewRegistry(), nil)
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	if m.agent != ag2 {
		t.Error("Ctrl+O should switch to ag2")
	}
}

func TestSingleAgentNoSwitch(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	reg := agent.NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg, icmd.NewRegistry(), nil)
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	if m.agent != ag {
		t.Error("single agent should not switch")
	}
}
