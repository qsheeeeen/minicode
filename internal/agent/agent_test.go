package agent

import (
	"context"
	"testing"

	"minicode/internal/domain"
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


