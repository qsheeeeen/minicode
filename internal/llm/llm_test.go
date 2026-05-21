package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"minicode/internal/domain"
)

func TestClient_Chat(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		res := Message{
			ID:      "msg_123",
			Role:    "assistant",
			Content: []domain.ContentBlock{{Type: "text", Text: "hello"}},
			Usage:   &domain.Usage{InputTokens: 10, OutputTokens: 5},
		}
		json.NewEncoder(w).Encode(res)
	}))
	defer ts.Close()

	c := NewClient("key", ts.URL)
	msg, err := c.Chat(context.Background(), []domain.MessageParam{{Role: "user", Content: "hi"}}, nil, ChatOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if msg.ID != "msg_123" {
		t.Errorf("expected msg_123, got %s", msg.ID)
	}
}

func TestClient_ChatStream(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", `{"type": "message_start", "message": {"usage": {"input_tokens": 5}}}`)
		fmt.Fprintf(w, "data: %s\n\n", `{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hello"}}`)
		fmt.Fprintf(w, "data: %s\n\n", `{"type": "message_delta", "usage": {"output_tokens": 3}}`)
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer ts.Close()

	c := NewClient("key", ts.URL)
	ch, err := c.ChatStream(context.Background(), []domain.MessageParam{{Role: "user", Content: "hi"}}, nil, ChatOptions{})
	if err != nil {
		t.Fatal(err)
	}

	var text string
	for evt := range ch {
		if evt.Error != nil {
			t.Fatal(evt.Error)
		}
		if evt.Type == "text" {
			text += evt.Delta
		}
	}
	if text != "hello" {
		t.Errorf("expected hello, got %s", text)
	}
}
