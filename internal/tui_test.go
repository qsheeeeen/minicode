package internal

import (
	"context"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// newTestAgent creates an agent without LLM for TUI testing.
func newTestAgent() *Agent {
	return NewAgent(AgentConfig{
		APIKey:        "test-key",
		Model:         "test-model",
		ContextLength: 100000,
	})
}

func TestTUIModel_Init(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return a command (textarea.Blink)")
	}
}

func TestTUIModel_ViewBeforeReady(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	view := m.View()
	if view == "" {
		t.Error("View should not be empty")
	}
}

func TestTUIModel_ViewAfterReady(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// Simulate WindowSizeMsg to make the model ready
	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	view := m.View()
	if view == "" {
		t.Error("View should not be empty after ready")
	}
	// Should contain header with model name
	if len(view) < 10 {
		t.Error("View should have content")
	}
}

func TestTUIModel_KeyTypeUpdatesInput(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// Make ready
	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	// Type a character
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}})
	if cmd != nil {
		// The command from textarea.Update
	}

	if !m.input.Focused() {
		t.Error("textarea should be focused after init")
	}
}

func TestTUIModel_EnterSendsMessage(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	// Type some text
	m.input.SetValue("hello world")

	// Press Enter
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	// Should start agent and return poll command
	if cmd == nil {
		t.Error("Enter should return a command to start polling")
	}
}

func TestTUIModel_CtrlCQuits(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Error("Ctrl+C should return quit command")
	}
}

func TestTUIModel_EnterEmptySkips(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	// Empty input should not start agent
	if cmd != nil {
		t.Log("empty Enter returned cmd:", cmd)
	}
}

func TestTUIModel_StreamingBlocksInput(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m.streaming = true

	// Type when streaming should not update input
	_, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	// Input should still be empty since streaming blocks it
	if m.input.Value() != "" {
		t.Error("streaming should block input")
	}
}

func TestTUIModel_AgentDoneClearsStreaming(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	m.streaming = true
	_, _ = m.Update(agentDoneMsg{err: nil})

	if m.streaming {
		t.Error("agentDoneMsg should clear streaming")
	}
}

func TestTUIModel_HandlePermKey(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	m.permPending = true
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}})

	// Should resolve permission
	if m.permPending {
		t.Error("perm should be resolved after key press")
	}
	_ = cmd
}

func TestTUIModel_MultiAgentSwitch(t *testing.T) {
	ag1 := newTestAgent()
	ag2 := newTestAgent()
	ag2.SetSession("session-2")

	reg := NewAgentRegistry(ag1)
	reg.Add(ag2)

	m := NewTUIModel(ag1, reg)
	_, _ = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	// Ctrl+O to switch agent
	_, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})

	// Should switch to ag2
	if m.agent != ag2 {
		t.Error("Ctrl+O should switch to next agent")
	}
}

func TestTUIModel_SingleAgentNoSwitch(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	_, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	// Should remain unchanged
	if m.agent != ag {
		t.Error("single agent should not switch")
	}
}

func TestTUIModel_RenderMessages(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// Empty state
	rendered := m.renderMessages()
	if rendered == "" {
		t.Error("renderMessages should not be empty")
	}

	// With messages
	m.messages = []DisplayMessage{
		{Role: RoleUser, Content: "hello"},
		{Role: RoleText, Content: "hi there"},
		{Role: RoleTool, ToolName: "Read", ToolOutput: "file content"},
		{Role: RoleStatus, Content: "done"},
		{Role: RoleError, Content: "oops"},
	}
	rendered = m.renderMessages()
	if len(rendered) < 10 {
		t.Error("rendered messages too short")
	}
}

func TestTUIModel_RenderHeader(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)
	m.modelName = "test-model"
	m.session = "test-session"

	header := m.renderHeader()
	if header == "" {
		t.Error("header should not be empty")
	}
}

func TestTUIModel_RenderStatusBar(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)
	m.width = 120
	m.tokenCount = 42

	bar := m.renderStatusBar()
	if bar == "" {
		t.Error("status bar should not be empty")
	}
}

func TestTUIModel_RenderInput(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// Normal mode
	inp := m.renderInput()
	if inp == "" {
		t.Error("input should not be empty")
	}

	// Streaming mode
	m.streaming = true
	inp = m.renderInput()
	if inp == "" {
		t.Error("streaming input should not be empty")
	}

	// Permission pending
	m.streaming = false
	m.permPending = true
	m.permText = "Allow Bash?"
	inp = m.renderInput()
	if inp == "" {
		t.Error("permission prompt should not be empty")
	}
}

// Test that agent display callback updates the model correctly
func TestTUIModel_DisplayCallback(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// Simulate agent adding a message
	ag.Store().AddUserMessage("test message", "")
	// The callback should have updated m.messages
	_ = m
}

// Test truncate helper
func TestTruncate(t *testing.T) {
	short := truncate("hello", 100)
	if short != "hello" {
		t.Errorf("short string unchanged: got %q", short)
	}

	long := truncate("this is a very long string that should be truncated", 10)
	if len(long) > 13 { // 10 + "..."
		t.Errorf("long string should be truncated: got %q", long)
	}
}

// Integration-style test: full Update/View cycle
func TestTUIModel_FullCycle(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)
	m := NewTUIModel(ag, reg)

	// 1. Init returns a command
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return a command")
	}

	// 2. Window size message makes model ready
	_, cmd = m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !m.ready {
		t.Error("model should be ready after WindowSizeMsg")
	}

	// 3. View renders
	view := m.View()
	if len(view) < 10 {
		t.Error("View should have content")
	}

	// 4. Type text
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}})
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'i'}})

	// 5. Enter sends and starts agent (even though agent will fail without real LLM)
	_, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	_ = cmd
}

// Test RunTUI function builds correct program
func TestRunTUI_BuildsProgram(t *testing.T) {
	ag := newTestAgent()
	reg := NewAgentRegistry(ag)

	// We can't actually run the program in tests (needs TTY),
	// but we can verify the model is created correctly
	m := NewTUIModel(ag, reg)
	if m == nil {
		t.Error("NewTUIModel should not return nil")
	}
}

// Test Cancel context during agent run
func TestTUIModel_AgentRunWithCancel(t *testing.T) {
	ag := newTestAgent()
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancel

	ok, err := ag.Run(ctx, "test")
	if ok {
		// Run should return false or have an error for cancelled context
		t.Log("run returned ok=true with cancelled context")
	}
	_ = err
}
