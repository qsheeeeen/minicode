package agent

import (
	"context"
	"testing"

	"minicode/internal/domain"
	"minicode/internal/skills"
)

func newTestAgent() *Agent {
	return NewAgent(domain.AgentConfig{APIKey: "test", Model: "test-model", ContextLength: 100})
}

func TestAgent_IsRunningGuard(t *testing.T) {
	ag := newTestAgent()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ok, err := ag.Run(ctx, "test", "")
	if err != nil {
		t.Logf("expected error from cancelled context: %s", err)
	}
	_ = ok
}

func TestAgent_SetSkills(t *testing.T) {
	ag := newTestAgent()
	sr := skills.NewSkillRegistry("/tmp")
	ag.SetSkills(sr)
	if ag.skills != sr {
		t.Error("skills should be set")
	}
}
