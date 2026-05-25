package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestRename(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	ag.SetSession("old-name")
	handled, _, _ := r.ParseAndExecute("/rename new-name", Context{Agent: ag})
	if !handled {
		t.Error("/rename should be handled")
	}
}

func TestRename_EmptyArgs(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, _ := r.ParseAndExecute("/rename", Context{})
	if !handled {
		t.Error("/rename without args should be handled (no-op)")
	}
}
