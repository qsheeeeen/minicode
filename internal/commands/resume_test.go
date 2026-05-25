package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestResume_List(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/resume", Context{})
	if !handled {
		t.Error("/resume without args should list sessions")
	}
	if _, ok := result.(SelectResult); !ok {
		if _, ok := result.(StatusResult); !ok {
			t.Errorf("/resume without args should return SelectResult or StatusResult, got %T", result)
		}
	}
}

func TestResume_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := r.ParseAndExecute("/resume nonexistent-session", Context{Agent: ag})
	if !handled {
		t.Error("/resume with name should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || !sr.IsError {
		t.Errorf("/resume nonexistent should return error StatusResult, got %T", result)
	}
}
