package tui

import (
	"strings"
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

func TestRenderAllRoles(t *testing.T) {
	m := newTestModel()
	m.Viewport.messages = []domain.DisplayMessage{
		{Role: domain.RoleUser, Content: "hi"},
		{Role: domain.RoleThinking, Content: "let me think"},
		{Role: domain.RoleText, Content: "response", IsStreaming: true},
		{Role: domain.RoleTool, ToolName: "Bash", ToolOutput: "command output"},
		{Role: domain.RoleStatus, Content: "done"},
		{Role: domain.RoleError, Content: "oops"},
	}
	rendered := m.Viewport.Render()
	for _, expect := range []string{"hi", "think", "response", "Bash", "command output", "done", "oops"} {
		if !strings.Contains(rendered, expect) {
			t.Errorf("renderMessages missing %q", expect)
		}
	}
}
