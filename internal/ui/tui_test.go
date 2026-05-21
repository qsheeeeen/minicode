package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestTUIModel_Init(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	reg := agent.NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg, nil)
	if m == nil {
		t.Fatal("expected non-nil model")
	}
}

func TestTUIModel_Update(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	reg := agent.NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg, nil)

	// Test WindowSizeMsg
	_, _ = m.Update(tea.WindowSizeMsg{Width: 100, Height: 40})
	if !m.ready {
		t.Error("expected ready after WindowSizeMsg")
	}
}
