package agent

import "testing"

func TestAgentRegistry_New(t *testing.T) {
	ag := newTestAgent()
	r := NewAgentRegistry(ag)
	if r == nil {
		t.Fatal("expected non-nil registry")
	}
	if r.Active() != ag {
		t.Error("initial agent should be active")
	}
}

func TestAgentRegistry_RegisterAndList(t *testing.T) {
	ag1 := newTestAgent()
	ag2 := newTestAgent()
	r := NewAgentRegistry(ag1)
	r.Register("2", ag2, "test task", "1")

	list := r.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 agents, got %d", len(list))
	}
}

func TestAgentRegistry_NextActive(t *testing.T) {
	ag1 := newTestAgent()
	ag2 := newTestAgent()
	r := NewAgentRegistry(ag1)
	r.Register("2", ag2, "test", "1")

	if r.Active() != ag1 {
		t.Error("expected ag1 active")
	}
	next := r.NextActive()
	if next != ag2 {
		t.Error("expected ag2 after NextActive")
	}
	if r.Active() != ag2 {
		t.Error("expected ag2 active after cycle")
	}
	next = r.NextActive()
	if next != ag1 {
		t.Error("expected ag1 after second cycle")
	}
}
