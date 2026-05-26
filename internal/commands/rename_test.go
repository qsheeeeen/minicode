package commands

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestRename(t *testing.T) {

	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	ag.SetSession("old-name")
	handled, _, _ := ParseAndExecute("/rename new-name", Context{Agent: ag})
	if !handled {
		t.Error("/rename should be handled")
	}
}

func TestRename_EmptyArgs(t *testing.T) {

	handled, _, _ := ParseAndExecute("/rename", Context{})
	if !handled {
		t.Error("/rename without args should be handled (no-op)")
	}
}
