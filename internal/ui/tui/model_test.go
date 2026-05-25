package tui

import (
	"context"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/agent"
	icmd "minicode/internal/commands"
	"minicode/internal/domain"
	"minicode/internal/tools"
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

func TestTextInput(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	for _, r := range "hello" {
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if !strings.Contains(m.Input.textarea.Value(), "hello") {
		t.Errorf("expected 'hello' in input, got %q", m.Input.textarea.Value())
	}
}

func TestEnterEmpty(t *testing.T) {
	m := newTestModel()
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil {
		t.Error("empty Enter should not return command")
	}
}

func TestAgentDoneClearsStreaming(t *testing.T) {
	m := newTestModel()
	m.Input.streaming = true
	m.Update(agentDoneMsg{err: nil})
	if m.Input.streaming {
		t.Error("agentDoneMsg should clear streaming")
	}
}

func TestAgentDoneWithError(t *testing.T) {
	m := newTestModel()
	m.Input.streaming = true
	m.Update(agentDoneMsg{err: context.DeadlineExceeded})
	if m.Status.err == nil {
		t.Error("should store error from agentDoneMsg")
	}
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !strings.Contains(m.View(), "ERR") {
		t.Error("View should show ERR for agent error")
	}
}

func TestStreamingBlocksInput(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Input.streaming = true
	prev := m.Input.textarea.Value()
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	if m.Input.textarea.Value() != prev {
		t.Error("streaming should block input")
	}
}

func TestTokenUpdate(t *testing.T) {
	m := newTestModel()
	m.Update(tokenUpdateMsg{total: 42})
	if m.Status.tokenCount != 42 {
		t.Errorf("expected 42 tokens, got %d", m.Status.tokenCount)
	}
}

func TestFullEnterCycle(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.ToolRegistry().Register(tools.NewBashTool())
	m := NewTUIModel(ag, icmd.NewRegistry(), nil)
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Input.textarea.SetValue("echo hello")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Error("Enter should return agent command")
	}
}
