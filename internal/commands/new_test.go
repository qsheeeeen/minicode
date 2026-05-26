package commands

import (
	"strings"
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestNew_WithName(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, result, _ := ParseAndExecute("/new my-session", Context{Agent: ag})
	if !handled {
		t.Error("/new my-session should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new my-session should change session name")
	}
	if sr, ok := result.(StatusResult); !ok || !strings.Contains(sr.Message, "my-session") {
		t.Errorf("expected success message with session name, got %v", result)
	}
}

func TestNew_WithoutName(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, _, _ := ParseAndExecute("/new", Context{Agent: ag})
	if !handled {
		t.Error("/new without name should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new without name should still change session name")
	}
}

func TestClear(t *testing.T) {
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := ParseAndExecute("/clear", Context{Agent: ag})
	if !handled {
		t.Error("/clear should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || !strings.Contains(sr.Message, "Cleared") {
		t.Errorf("/clear should return StatusResult with 'Cleared', got %v", result)
	}
}
