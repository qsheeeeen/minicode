package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestNew_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, _, _ := r.ParseAndExecute("/new my-session", Context{Agent: ag})
	if !handled {
		t.Error("/new my-session should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new my-session should change session name")
	}
}

func TestNew_WithoutName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, _, _ := r.ParseAndExecute("/new", Context{Agent: ag})
	if !handled {
		t.Error("/new without name should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new without name should still change session name")
	}
}
