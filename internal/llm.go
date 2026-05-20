package internal

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

// ---- LLM API types ----

// LLMTool is a tool definition sent to the API.
type LLMTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// LLMUsage tracks token consumption from the API response.
type LLMUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

// LLMMessage is the top-level API response.
type LLMMessage struct {
	ID      string         `json:"id"`
	Content []ContentBlock `json:"content"`
	Model   string         `json:"model"`
	Role    string         `json:"role"`
	Usage   *LLMUsage      `json:"usage,omitempty"`
}

// StreamEvent represents a parsed SSE event from the streaming endpoint.
type StreamEvent struct {
	Type  string       // "thinking", "text", "input_json_delta", "content_block_start", "content_block_stop", "message_delta"
	Index int          // block index (for input_json_delta and content_block events)
	Delta string       // for thinking/text/input_json deltas
	Block ContentBlock // for content_block_start
	Usage *LLMUsage    // for message_delta
	Error error
}

// ChatOptions contains optional parameters for a chat request.
type ChatOptions struct {
	Model     string
	MaxTokens int
	System    string
	Signal    <-chan struct{}
}

// ---- Client ----

// Client wraps the Anthropic Messages API via direct HTTP.
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

// Chat sends a non-streaming request and returns the complete response.
func (c *Client) Chat(ctx context.Context, messages []MessageParam, tools []LLMTool, opts ChatOptions) (*LLMMessage, error) {
	return c.send(ctx, messages, tools, opts, false)
}

// ChatStream sends a streaming request and returns a channel of events.
func (c *Client) ChatStream(ctx context.Context, messages []MessageParam, tools []LLMTool, opts ChatOptions) (<-chan StreamEvent, error) {
	ch := make(chan StreamEvent, 64)
	go func() {
		defer close(ch)
		c.streamSSE(ctx, messages, tools, opts, ch)
	}()
	return ch, nil
}

type chatRequest struct {
	Model     string         `json:"model"`
	MaxTokens int            `json:"max_tokens"`
	System    string         `json:"system,omitempty"`
	Messages  []MessageParam `json:"messages"`
	Tools     []LLMTool      `json:"tools,omitempty"`
	Stream    bool           `json:"stream"`
}

func (c *Client) send(ctx context.Context, messages []MessageParam, tools []LLMTool, opts ChatOptions, stream bool) (*LLMMessage, error) {
	model := opts.Model
	if model == "" {
		model = "claude-sonnet-4-5"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	payload, err := json.Marshal(chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    stream,
	})
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

	var msg LLMMessage
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &msg, nil
}

func (c *Client) streamSSE(ctx context.Context, messages []MessageParam, tools []LLMTool, opts ChatOptions, ch chan<- StreamEvent) {
	model := opts.Model
	if model == "" {
		model = "claude-sonnet-4-5"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	payload, err := json.Marshal(chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    true,
	})
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

		var raw map[string]any
		if err := json.Unmarshal([]byte(data), &raw); err != nil {
			continue
		}

		evtType, _ := raw["type"].(string)
		evt := StreamEvent{Type: evtType}
		if idx, ok := raw["index"].(float64); ok {
			evt.Index = int(idx)
		}

		switch evtType {
		case "content_block_delta":
			if delta, ok := raw["delta"].(map[string]any); ok {
				if dt, ok := delta["type"].(string); ok {
					switch dt {
					case "thinking_delta":
						evt.Type = "thinking"
						evt.Delta, _ = delta["thinking"].(string)
					case "text_delta":
						evt.Type = "text"
						evt.Delta, _ = delta["text"].(string)
					case "input_json_delta":
						evt.Type = "input_json_delta"
						evt.Delta, _ = delta["partial_json"].(string)
					}
				}
			}
		case "content_block_start":
			if cb, ok := raw["content_block"].(map[string]any); ok {
				evt.Block = mapToCB(cb)
			}
		case "message_delta":
			if u, ok := raw["usage"].(map[string]any); ok {
				evt.Usage = mapToLLMUsage(u)
			}
		}

		ch <- evt
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("sse read: %w", err)}
	}
}

func mapToCB(m map[string]any) ContentBlock {
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

func mapToLLMUsage(m map[string]any) *LLMUsage {
	u := &LLMUsage{}
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
