package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestClear(t *testing.T) {
	
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := ParseAndExecute("/clear", Context{Agent: ag})
	if !handled {
		t.Error("/clear should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || sr.Message != "(Cleared)" {
		t.Errorf("/clear should return StatusResult with '(Cleared)', got %T %s", result, sr.Message)
	}
}
