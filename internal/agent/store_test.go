package agent

import (
	"testing"

	"minicode/internal/domain"
)

func TestStore_AddUserMessage(t *testing.T) {
	s := NewStore()
	s.AddUserMessage("hello", "hi")
	turns := s.Turns()
	if len(turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(turns))
	}
	if turns[0].Role != "user" {
		t.Errorf("expected user, got %s", turns[0].Role)
	}
	if turns[0].Display != "hi" {
		t.Errorf("expected display hi, got %s", turns[0].Display)
	}
}

func TestStore_StartAssistantTurn(t *testing.T) {
	s := NewStore()
	s.StartAssistantTurn()
	s.AppendToLastAssistantTurn(domain.ContentBlock{Type: "text", Text: "first"})
	s.StartAssistantTurn() // should start a new one
	s.AppendToLastAssistantTurn(domain.ContentBlock{Type: "text", Text: "second"})

	turns := s.Turns()
	if len(turns) != 2 {
		t.Fatalf("expected 2 turns, got %d", len(turns))
	}
}
