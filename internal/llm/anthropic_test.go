package llm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"minicode/internal/domain"
)

func TestClient_ChatStream(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		// The official SDK is quite strict about SSE format. 
		// For a simple test, we just want to ensure our wrapper passes through data.
		fmt.Fprintf(w, "event: message_start\ndata: %s\n\n", `{"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "content": [], "model": "m1", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 5, "output_tokens": 0}}}`)
		fmt.Fprintf(w, "event: content_block_start\ndata: %s\n\n", `{"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}`)
		fmt.Fprintf(w, "event: content_block_delta\ndata: %s\n\n", `{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hello"}}`)
		fmt.Fprintf(w, "event: message_delta\ndata: %s\n\n", `{"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": 3}}`)
		fmt.Fprint(w, "event: message_stop\ndata: {\"type\": \"message_stop\"}\n\n")
	}))
	defer ts.Close()

	c := NewClient("key", ts.URL)
	ch, err := c.ChatStream(context.Background(), []domain.MessageParam{{Role: "user", Content: "hi"}}, nil, ChatOptions{})
	if err != nil {
		t.Fatal(err)
	}

	var text string
	var inputTokens, outputTokens int
	for evt := range ch {
		if evt.Error != nil {
			t.Fatal(evt.Error)
		}
		switch evt.Type {
		case "text":
			text += evt.Delta
		case "message_start":
			inputTokens = evt.Usage.InputTokens
		case "message_delta":
			outputTokens = evt.Usage.OutputTokens
		}
	}
	if text != "hello" {
		t.Errorf("expected hello, got %s", text)
	}
	if inputTokens != 5 {
		t.Errorf("expected 5 input tokens, got %d", inputTokens)
	}
	if outputTokens != 3 {
		t.Errorf("expected 3 output tokens, got %d", outputTokens)
	}
}
