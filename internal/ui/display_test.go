package ui

import (
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestToDisplayMessages_User(t *testing.T) {
	turns := []domain.MessageParam{
		{Role: "user", Content: "hello"},
	}
	msgs := ToDisplayMessages(turns, nil, false)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(msgs))
	}
	if msgs[0].Role != domain.RoleUser {
		t.Errorf("expected user role, got %s", msgs[0].Role)
	}
}

func TestToDisplayMessages_Assistant(t *testing.T) {
	turns := []domain.MessageParam{
		{Role: "assistant", Content: []domain.ContentBlock{
			{Type: "text", Text: "hi"},
		}},
	}
	msgs := ToDisplayMessages(turns, nil, false)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(msgs))
	}
	if msgs[0].Role != domain.RoleText || msgs[0].Content != "hi" {
		t.Errorf("unexpected msg: %+v", msgs[0])
	}
}

func TestToDisplayMessages_Status(t *testing.T) {
	turns := []domain.MessageParam{{Role: "user", Content: "q"}}
	statuses := []agent.StatusMessage{
		{Role: domain.RoleStatus, Content: "working", TurnIndex: 1},
	}
	msgs := ToDisplayMessages(turns, statuses, false)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 msgs, got %d", len(msgs))
	}
	if msgs[1].Role != domain.RoleStatus {
		t.Errorf("expected status role, got %s", msgs[1].Role)
	}
}
