package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestSkills(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := r.ParseAndExecute("/skills", Context{Agent: ag})
	if !handled {
		t.Error("/skills should be handled")
	}
	if _, ok := result.(StatusResult); !ok {
		t.Errorf("/skills should return StatusResult, got %T", result)
	}
}
