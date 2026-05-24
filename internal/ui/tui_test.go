package ui

import (
	"context"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/agent"
	"minicode/internal/domain"
	"minicode/internal/tools"
)

func newTestModel() *TUIModel {
	cfg := domain.AgentConfig{APIKey: "test", Model: "test-model", ContextLength: 100000}
	ag := agent.NewAgent(cfg)
	reg := agent.NewAgentRegistry(ag)
	return NewTUIModel(ag, reg, NewCommandRegistry(), nil)
}

func TestTUIModel_Init(t *testing.T) {
	m := newTestModel()
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return textarea.Blink command")
	}
}

func TestTUIModel_WindowSize(t *testing.T) {
	m := newTestModel()
	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !m.ready {
		t.Error("model should be ready after WindowSizeMsg")
	}
}

func TestTUIModel_TextInput(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	for _, r := range "hello" {
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if !strings.Contains(m.input.Value(), "hello") {
		t.Errorf("expected 'hello' in input, got %q", m.input.Value())
	}
	if !m.input.Focused() {
		t.Error("textarea should be focused")
	}
}

func TestTUIModel_EnterEmpty(t *testing.T) {
	m := newTestModel()
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil {
		t.Error("empty Enter should not return command")
	}
}

func TestTUIModel_CtrlCQuits(t *testing.T) {
	m := newTestModel()
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Error("Ctrl+C should return quit command")
	}
}

func TestTUIModel_ViewBeforeReady(t *testing.T) {
	m := newTestModel()
	if !strings.Contains(m.View(), "Initializing") {
		t.Error("View before ready should show Initializing")
	}
}

func TestTUIModel_ViewAfterReady(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := m.View()
	if !strings.Contains(view, "test-model") {
		t.Errorf("View should contain model name, got: %s", view)
	}
}

func TestTUIModel_AgentDoneClearsStreaming(t *testing.T) {
	m := newTestModel()
	m.streaming = true
	m.Update(agentDoneMsg{err: nil})
	if m.streaming {
		t.Error("agentDoneMsg should clear streaming")
	}
}

func TestTUIModel_AgentDoneWithError(t *testing.T) {
	m := newTestModel()
	m.streaming = true
	m.Update(agentDoneMsg{err: context.DeadlineExceeded})
	if m.err == nil {
		t.Error("should store error from agentDoneMsg")
	}
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !strings.Contains(m.View(), "ERR") {
		t.Error("View should show ERR for agent error")
	}
}

func TestTUIModel_AgentSwitch(t *testing.T) {
	ag1 := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag2 := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m2", ContextLength: 100})
	ag2.SetSession("session-2")
	reg := agent.NewAgentRegistry(ag1)
	reg.Register("2", ag2, "test task", "1")

	m := NewTUIModel(ag1, reg, NewCommandRegistry(), nil)
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	if m.agent != ag2 {
		t.Error("Ctrl+O should switch to ag2")
	}
}

func TestTUIModel_SingleAgentNoSwitch(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	reg := agent.NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg, NewCommandRegistry(), nil)
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	if m.agent != ag {
		t.Error("single agent should not switch")
	}
}

func TestTUIModel_StreamingBlocksInput(t *testing.T) {
	m := newTestModel()
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.streaming = true
	prev := m.input.Value()
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	if m.input.Value() != prev {
		t.Error("streaming should block input")
	}
}

func TestTUIModel_PermissionPrompt(t *testing.T) {
	m := newTestModel()
	m.permPending = true
	m.permText = "Allow Bash?"
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})
	if m.permPending {
		t.Error("perm should resolve after 'y'")
	}
}

func TestTUIModel_TokenUpdate(t *testing.T) {
	m := newTestModel()
	m.Update(tokenUpdateMsg{total: 42})
	if m.tokenCount != 42 {
		t.Errorf("expected 42 tokens, got %d", m.tokenCount)
	}
}

func TestTUIModel_RenderAllRoles(t *testing.T) {
	m := newTestModel()
	m.messages = []domain.DisplayMessage{
		{Role: domain.RoleUser, Content: "hi"},
		{Role: domain.RoleThinking, Content: "let me think"},
		{Role: domain.RoleText, Content: "response", IsStreaming: true},
		{Role: domain.RoleTool, ToolName: "Bash", ToolOutput: "command output"},
		{Role: domain.RoleStatus, Content: "done"},
		{Role: domain.RoleError, Content: "oops"},
	}
	rendered := m.renderMessages()
	for _, expect := range []string{"hi", "think", "response", "Bash", "command output", "done", "oops"} {
		if !strings.Contains(rendered, expect) {
			t.Errorf("renderMessages missing %q", expect)
		}
	}
}

func TestTUIModel_FullEnterCycle(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.ToolRegistry().Register(tools.NewBashTool())
	reg := agent.NewAgentRegistry(ag)

	m := NewTUIModel(ag, reg, NewCommandRegistry(), nil)
	m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	m.input.SetValue("echo hello")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Error("Enter should return agent command")
	}
}
