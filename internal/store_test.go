package internal

import "testing"

func TestStore_AddUserMessage(t *testing.T) {
	s := NewStore()
	s.AddUserMessage("hello", "")
	turns := s.Turns()
	if len(turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(turns))
	}
	if turns[0].Role != "user" || turns[0].Content != "hello" {
		t.Errorf("unexpected turn: %+v", turns[0])
	}
}

func TestStore_AddUserMessageWithDisplay(t *testing.T) {
	s := NewStore()
	s.AddUserMessage("expanded prompt text", "user-facing text")
	turns := s.Turns()
	if turns[0].Display != "user-facing text" {
		t.Errorf("expected display override, got %q", turns[0].Display)
	}
}

func TestStore_ToLLMMessagesStripsDisplay(t *testing.T) {
	s := NewStore()
	s.AddUserMessage("llm text", "display text")
	llmMsgs := s.ToLLMMessages()
	if llmMsgs[0].Display != "" {
		t.Error("ToLLMMessages should strip Display field")
	}
}

func TestStore_StreamingState(t *testing.T) {
	s := NewStore()
	if s.IsStreaming() {
		t.Error("expected streaming to start false")
	}
	s.SetStreaming(true)
	if !s.IsStreaming() {
		t.Error("expected streaming to be true")
	}
}

func TestStore_AppendToAssistantTurn(t *testing.T) {
	s := NewStore()
	s.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: "first"})
	s.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: "second"})

	turns := s.Turns()
	if len(turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(turns))
	}
	blocks := turns[0].Content.([]ContentBlock)
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}
	if blocks[0].Text != "first" || blocks[1].Text != "second" {
		t.Error("block content mismatch")
	}
}

func TestStore_LastBlock(t *testing.T) {
	s := NewStore()
	if s.LastBlock() != nil {
		t.Error("expected nil for empty store")
	}
	s.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: "hello"})
	last := s.LastBlock()
	if last == nil || last.Text != "hello" {
		t.Error("unexpected last block")
	}
}

func TestStore_UpdateLastBlock(t *testing.T) {
	s := NewStore()
	s.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: "hel"})
	s.UpdateLastBlock("hello", "")

	last := s.LastBlock()
	if last.Text != "hello" {
		t.Errorf("expected 'hello', got %q", last.Text)
	}
}

func TestStore_AddToolResults(t *testing.T) {
	s := NewStore()
	s.AddToolResults([]toolResultItem{
		{ToolUseID: "call_1", Content: "result1"},
		{ToolUseID: "call_2", Content: "result2"},
	})
	turns := s.Turns()
	if len(turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(turns))
	}
	if turns[0].Role != "user" {
		t.Error("tool results should create a user turn")
	}
}

func TestStore_AddStatus(t *testing.T) {
	s := NewStore()
	s.AddStatus(RoleStatus, "test status")
	display := s.ToDisplayMessages()
	// Status with TurnIndex == len(turns) (0) goes at index 0
	if len(display) != 1 || display[0].Role != RoleStatus {
		t.Errorf("unexpected display: %+v", display)
	}
}

func TestStore_Clear(t *testing.T) {
	s := NewStore()
	s.AddUserMessage("hello", "")
	s.Clear()
	if len(s.Turns()) != 0 {
		t.Error("expected empty turns after clear")
	}
}

func TestStore_OnChange(t *testing.T) {
	s := NewStore()
	called := false
	s.OnChange(func() { called = true })
	s.AddUserMessage("hello", "")
	if !called {
		t.Error("expected onChange to be called")
	}
}
