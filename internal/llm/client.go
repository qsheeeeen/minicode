// Package llm provides the Anthropic API client wrapper.
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// MessageParam mirrors the Anthropic API message format.
type MessageParam struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// Tool definition for the Anthropic API.
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// ContentBlock is a single block in an assistant response.
type ContentBlock struct {
	Type      string         `json:"type"`
	Text      string         `json:"text,omitempty"`
	Thinking  string         `json:"thinking,omitempty"`
	ID        string         `json:"id,omitempty"`
	Name      string         `json:"name,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
}

// Usage tracks token consumption.
type Usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

// Message is the top-level Anthropic API response.
type Message struct {
	ID      string        `json:"id"`
	Content []ContentBlock `json:"content"`
	Model   string        `json:"model"`
	Role    string        `json:"role"`
	Usage   *Usage        `json:"usage,omitempty"`
}

// StreamEvent represents a parsed SSE event from the streaming endpoint.
type StreamEvent struct {
	Type  string       // "thinking", "text", "content_block_start", "content_block_stop", "message_stop"
	Delta string       // for thinking/text deltas
	Block ContentBlock // for content_block_start
	Usage *Usage       // for message_stop
	Error error
}

// ChatOptions contains optional parameters for a chat request.
type ChatOptions struct {
	Model     string
	MaxTokens int
	System    string
	Signal    <-chan struct{} // equivalent to AbortSignal
}

// Client wraps the Anthropic Messages API.
// Currently uses direct HTTP; will be replaced with the official Go SDK.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// NewClient creates a new Anthropic API client.
func NewClient(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	return &Client{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{},
	}
}

// chatRequest is the JSON body sent to the Messages API.
type chatRequest struct {
	Model     string         `json:"model"`
	MaxTokens int            `json:"max_tokens"`
	System    string         `json:"system,omitempty"`
	Messages  []MessageParam `json:"messages"`
	Tools     []Tool         `json:"tools,omitempty"`
	Stream    bool           `json:"stream"`
}

// Chat sends a non-streaming request and returns the complete response.
func (c *Client) Chat(ctx context.Context, messages []MessageParam, tools []Tool, opts ChatOptions) (*Message, error) {
	return c.send(ctx, messages, tools, opts, false)
}

// ChatStream sends a streaming request and returns a channel of events.
func (c *Client) ChatStream(ctx context.Context, messages []MessageParam, tools []Tool, opts ChatOptions) (<-chan StreamEvent, error) {
	// We use a goroutine that reads SSE and pumps events.
	// The standard Anthropic Go SDK would handle this natively; this is a minimal
	// implementation that will be replaced when we pull in the official SDK.
	ch := make(chan StreamEvent, 64)
	go func() {
		defer close(ch)
		c.streamSSE(ctx, messages, tools, opts, ch)
	}()
	return ch, nil
}

func (c *Client) send(ctx context.Context, messages []MessageParam, tools []Tool, opts ChatOptions, stream bool) (*Message, error) {
	model := opts.Model
	if model == "" {
		model = "claude-sonnet-4-5"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	body := chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    stream,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("api error %d: %s", resp.StatusCode, string(b))
	}

	var msg Message
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &msg, nil
}

func (c *Client) streamSSE(ctx context.Context, messages []MessageParam, tools []Tool, opts ChatOptions, ch chan<- StreamEvent) {
	// Build a streaming request
	model := opts.Model
	if model == "" {
		model = "claude-sonnet-4-5"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	body := chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    true,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("marshal request: %w", err)}
		return
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("create request: %w", err)}
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.http.Do(req)
	if err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("http request: %w", err)}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		ch <- StreamEvent{Error: fmt.Errorf("api error %d: %s", resp.StatusCode, string(b))}
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		case <-opts.Signal:
			return
		default:
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			return
		}

		var event StreamEvent
		var raw map[string]any
		if err := json.Unmarshal([]byte(data), &raw); err != nil {
			continue
		}

		evtType, _ := raw["type"].(string)
		event.Type = evtType

		switch evtType {
		case "content_block_delta":
			delta, _ := raw["delta"].(map[string]any)
			if dt, ok := delta["type"].(string); ok {
				switch dt {
				case "thinking_delta":
					event.Type = "thinking"
					event.Delta, _ = delta["thinking"].(string)
				case "text_delta":
					event.Type = "text"
					event.Delta, _ = delta["text"].(string)
				}
			}
		case "content_block_start":
			if cb, ok := raw["content_block"].(map[string]any); ok {
				event.Block = mapToBlock(cb)
			}
		case "content_block_stop":
			// index is in raw["index"]; we don't need it for display
		case "message_delta":
			if u, ok := raw["usage"].(map[string]any); ok {
				event.Usage = mapToUsage(u)
			}
		}

		ch <- event
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("sse read: %w", err)}
	}
}

func mapToBlock(m map[string]any) ContentBlock {
	cb := ContentBlock{}
	if t, ok := m["type"].(string); ok {
		cb.Type = t
	}
	if v, ok := m["text"].(string); ok {
		cb.Text = v
	}
	if v, ok := m["thinking"].(string); ok {
		cb.Thinking = v
	}
	if v, ok := m["id"].(string); ok {
		cb.ID = v
	}
	if v, ok := m["name"].(string); ok {
		cb.Name = v
	}
	if input, ok := m["input"].(map[string]any); ok {
		cb.Input = input
	}
	return cb
}

func mapToUsage(m map[string]any) *Usage {
	u := &Usage{}
	if v, ok := m["input_tokens"].(float64); ok {
		u.InputTokens = int(v)
	}
	if v, ok := m["output_tokens"].(float64); ok {
		u.OutputTokens = int(v)
	}
	if v, ok := m["cache_creation_input_tokens"].(float64); ok {
		u.CacheCreationInputTokens = int(v)
	}
	if v, ok := m["cache_read_input_tokens"].(float64); ok {
		u.CacheReadInputTokens = int(v)
	}
	return u
}
