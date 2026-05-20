package internal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClient_ChatSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key" {
			t.Error("missing api key header")
		}
		json.NewEncoder(w).Encode(LLMMessage{
			ID:    "msg_1",
			Model: "claude-test",
			Role:  "assistant",
			Content: []ContentBlock{
				{Type: "text", Text: "Hello!"},
			},
			Usage: &LLMUsage{InputTokens: 10, OutputTokens: 5},
		})
	}))
	defer srv.Close()

	client := NewClient("test-key", srv.URL)
	msg, err := client.Chat(context.Background(), []MessageParam{
		{Role: "user", Content: "hi"},
	}, nil, ChatOptions{Model: "claude-test"})

	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if msg.Usage == nil || msg.Usage.InputTokens != 10 {
		t.Error("usage not parsed correctly")
	}
	if len(msg.Content) != 1 || msg.Content[0].Text != "Hello!" {
		t.Error("content not parsed correctly")
	}
}

func TestClient_ChatAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"bad key"}}`))
	}))
	defer srv.Close()

	client := NewClient("bad-key", srv.URL)
	_, err := client.Chat(context.Background(), nil, nil, ChatOptions{})
	if err == nil {
		t.Error("expected error for 401")
	}
}

func TestClient_ChatStreamEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)

		events := []string{
			`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`,
			`data: {"type":"content_block_stop","index":0}`,
			`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}`,
			`data: [DONE]`,
		}
		for _, evt := range events {
			w.Write([]byte(evt + "\n\n"))
			flusher.Flush()
		}
	}))
	defer srv.Close()

	client := NewClient("test-key", srv.URL)
	ch, err := client.ChatStream(context.Background(), []MessageParam{
		{Role: "user", Content: "hi"},
	}, nil, ChatOptions{Model: "claude-test"})
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	var deltas []string
	for evt := range ch {
		if evt.Error != nil {
			t.Fatalf("unexpected event error: %s", evt.Error)
		}
		if evt.Type == "text" {
			deltas = append(deltas, evt.Delta)
		}
	}

	combined := ""
	for _, d := range deltas {
		combined += d
	}
	if combined != "Hello world" {
		t.Errorf("expected 'Hello world', got %q", combined)
	}
}

func TestClient_ChatStreamContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Block forever
		select {}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	client := NewClient("test-key", srv.URL)
	ch, err := client.ChatStream(ctx, nil, nil, ChatOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	cancel()
	// Wait for channel to close
	time.Sleep(100 * time.Millisecond)

	// Drain channel
	for range ch {
	}
}

func TestClient_ChatStreamWithToolUse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)

		events := []string{
			`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"Read","input":{}}}`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"file.txt\"}"}}`,
			`data: {"type":"content_block_stop","index":0}`,
			`data: [DONE]`,
		}
		for _, evt := range events {
			w.Write([]byte(evt + "\n\n"))
			flusher.Flush()
		}
	}))
	defer srv.Close()

	client := NewClient("test-key", srv.URL)
	ch, _ := client.ChatStream(context.Background(), nil, nil, ChatOptions{})

	var inputDeltas []string
	var toolBlocks []ContentBlock
	for evt := range ch {
		if evt.Error != nil {
			t.Fatalf("unexpected error: %s", evt.Error)
		}
		if evt.Type == "input_json_delta" {
			inputDeltas = append(inputDeltas, evt.Delta)
		}
		if evt.Type == "content_block_start" && evt.Block.Type == "tool_use" {
			toolBlocks = append(toolBlocks, evt.Block)
		}
	}

	if len(inputDeltas) == 0 {
		t.Error("expected input_json_delta events")
	}
	if len(toolBlocks) == 0 || toolBlocks[0].Name != "Read" {
		t.Error("expected tool_use block with name Read")
	}
}

func TestNewClient_Defaults(t *testing.T) {
	client := NewClient("key", "")
	if client.baseURL != "https://api.anthropic.com" {
		t.Errorf("expected default baseURL, got %s", client.baseURL)
	}
}

func TestChatOptions_Defaults(t *testing.T) {
	opts := ChatOptions{}
	if opts.Model != "" {
		t.Error("zero value model should be empty")
	}
	if opts.MaxTokens != 0 {
		t.Error("zero value maxTokens should be 0")
	}
}
