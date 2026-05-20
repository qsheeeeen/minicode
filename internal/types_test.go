package internal

import (
	"testing"
	"time"
)

func TestToDisplayMessages_UserText(t *testing.T) {
	turns := []MessageParam{
		{Role: "user", Content: "hello world"},
	}
	display := ToDisplayMessages(turns, nil, false)
	if len(display) != 1 {
		t.Fatalf("expected 1 message, got %d", len(display))
	}
	if display[0].Role != RoleUser || display[0].Content != "hello world" {
		t.Errorf("unexpected user message: %+v", display[0])
	}
}

func TestToDisplayMessages_DisplayOverride(t *testing.T) {
	turns := []MessageParam{
		{Role: "user", Content: "expanded prompt", Display: "user-facing text"},
	}
	display := ToDisplayMessages(turns, nil, false)
	if display[0].Content != "user-facing text" {
		t.Errorf("expected display override, got %q", display[0].Content)
	}
}

func TestToDisplayMessages_AssistantText(t *testing.T) {
	turns := []MessageParam{
		{Role: "assistant", Content: []ContentBlock{
			{Type: "text", Text: "Hello from assistant"},
		}},
	}
	display := ToDisplayMessages(turns, nil, false)
	if len(display) != 1 {
		t.Fatalf("expected 1 message, got %d", len(display))
	}
	if display[0].Role != RoleText || display[0].Content != "Hello from assistant" {
		t.Errorf("unexpected message: %+v", display[0])
	}
}

func TestToDisplayMessages_Thinking(t *testing.T) {
	turns := []MessageParam{
		{Role: "assistant", Content: []ContentBlock{
			{Type: "thinking", Thinking: "Let me think about this..."},
		}},
	}
	display := ToDisplayMessages(turns, nil, false)
	if display[0].Role != RoleThinking || display[0].Content != "Let me think about this..." {
		t.Errorf("unexpected thinking: %+v", display[0])
	}
}

func TestToDisplayMessages_ToolUseAndResult(t *testing.T) {
	turns := []MessageParam{
		{Role: "assistant", Content: []ContentBlock{
			{Type: "tool_use", ID: "call_1", Name: "Read", Input: map[string]any{"path": "file.txt"}},
		}},
		{Role: "user", Content: []ContentBlock{
			{Type: "tool_result", ToolUseID: "call_1", Content: "file contents here"},
		}},
	}
	display := ToDisplayMessages(turns, nil, false)
	// Should have 1 tool message with output
	if len(display) != 1 {
		t.Fatalf("expected 1 tool message, got %d", len(display))
	}
	msg := display[0]
	if msg.Role != RoleTool || msg.ToolName != "Read" || msg.SlotID != "call_1" {
		t.Errorf("unexpected tool message: %+v", msg)
	}
	if msg.ToolOutput != "file contents here" {
		t.Errorf("expected tool output, got %q", msg.ToolOutput)
	}
}

func TestToDisplayMessages_StreamingFlag(t *testing.T) {
	turns := []MessageParam{
		{Role: "assistant", Content: []ContentBlock{
			{Type: "text", Text: "streaming content"},
		}},
	}
	display := ToDisplayMessages(turns, nil, true)
	if !display[0].IsStreaming {
		t.Error("expected IsStreaming to be true")
	}

	display2 := ToDisplayMessages(turns, nil, false)
	if display2[0].IsStreaming {
		t.Error("expected IsStreaming to be false")
	}
}

func TestToDisplayMessages_StatusInterleaving(t *testing.T) {
	turns := []MessageParam{
		{Role: "user", Content: "hello"},
	}
	statuses := []StatusMessage{
		{Role: RoleStatus, Content: "ready", TurnIndex: 1, Timestamp: time.Now()},
	}
	display := ToDisplayMessages(turns, statuses, false)
	// Should be: user message, then status
	if len(display) != 2 {
		t.Fatalf("expected 2 messages, got %d: %+v", len(display), display)
	}
	if display[1].Role != RoleStatus || display[1].Content != "ready" {
		t.Errorf("unexpected status: %+v", display[1])
	}
}

func TestToDisplayMessages_StatusBeforeAll(t *testing.T) {
	turns := []MessageParam{
		{Role: "user", Content: "hello"},
	}
	statuses := []StatusMessage{
		{Role: RoleStatus, Content: "startup", TurnIndex: 0, Timestamp: time.Now()},
	}
	display := ToDisplayMessages(turns, statuses, false)
	if display[0].Role != RoleStatus || display[0].Content != "startup" {
		t.Errorf("expected status before all, got %+v", display[0])
	}
}
