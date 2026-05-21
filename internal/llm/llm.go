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

	"minicode/internal/domain"
)

// Tool is a tool definition sent to the API.
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// Message is the top-level API response.
type Message struct {
	ID      string                `json:"id"`
	Content []domain.ContentBlock `json:"content"`
	Model   string                `json:"model"`
	Role    string                `json:"role"`
	Usage   *domain.Usage         `json:"usage,omitempty"`
}

// StreamEvent represents a parsed SSE event from the streaming endpoint.
type StreamEvent struct {
	Type  string              // "thinking", "text", "input_json_delta", "content_block_start", "content_block_stop", "message_delta"
	Index int                 // block index
	Delta string              // for thinking/text/input_json deltas
	Block domain.ContentBlock // for content_block_start
	Usage *domain.Usage       // for message_delta
	Error error
}

// ChatOptions contains optional parameters for a chat request.
type ChatOptions struct {
	Model           string
	MaxTokens       int
	System          string
	ThinkingEnabled bool
	ThinkingBudget  int
	Effort          string
	Signal          <-chan struct{}
}

// Client wraps the Anthropic Messages API.
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

// Chat sends a non-streaming request.
func (c *Client) Chat(ctx context.Context, messages []domain.MessageParam, tools []Tool, opts ChatOptions) (*Message, error) {
	return c.send(ctx, messages, tools, opts, false)
}

// ChatStream sends a streaming request.
func (c *Client) ChatStream(ctx context.Context, messages []domain.MessageParam, tools []Tool, opts ChatOptions) (<-chan StreamEvent, error) {
	ch := make(chan StreamEvent, 64)
	go func() {
		defer close(ch)
		c.streamSSE(ctx, messages, tools, opts, ch)
	}()
	return ch, nil
}

type chatRequest struct {
	Model        string                `json:"model"`
	MaxTokens    int                   `json:"max_tokens"`
	System       string                `json:"system,omitempty"`
	Messages     []domain.MessageParam `json:"messages"`
	Tools        []Tool                `json:"tools,omitempty"`
	Stream       bool                  `json:"stream"`
	Thinking     map[string]any        `json:"thinking,omitempty"`
	OutputConfig map[string]any        `json:"output_config,omitempty"`
}

func (c *Client) send(ctx context.Context, messages []domain.MessageParam, tools []Tool, opts ChatOptions, stream bool) (*Message, error) {
	model := opts.Model
	if model == "" {
		model = "claude-3-7-sonnet-20250219"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	creq := chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    stream,
	}

	if opts.ThinkingEnabled {
		budget := opts.ThinkingBudget
		if budget == 0 {
			budget = 4096
		}
		creq.Thinking = map[string]any{
			"type":          "enabled",
			"budget_tokens": budget,
		}
		if opts.Effort != "" {
			creq.OutputConfig = map[string]any{
				"effort": opts.Effort,
			}
		}
	}

	payload, err := json.Marshal(creq)
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

func (c *Client) streamSSE(ctx context.Context, messages []domain.MessageParam, tools []Tool, opts ChatOptions, ch chan<- StreamEvent) {
	model := opts.Model
	if model == "" {
		model = "claude-3-7-sonnet-20250219"
	}
	maxTokens := opts.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}

	creq := chatRequest{
		Model:     model,
		MaxTokens: maxTokens,
		System:    opts.System,
		Messages:  messages,
		Tools:     tools,
		Stream:    true,
	}

	if opts.ThinkingEnabled {
		budget := opts.ThinkingBudget
		if budget == 0 {
			budget = 4096
		}
		creq.Thinking = map[string]any{
			"type":          "enabled",
			"budget_tokens": budget,
		}
		if opts.Effort != "" {
			creq.OutputConfig = map[string]any{
				"effort": opts.Effort,
			}
		}
	}

	payload, err := json.Marshal(creq)
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
		case "message_start":
			if msg, ok := raw["message"].(map[string]any); ok {
				if u, ok := msg["usage"].(map[string]any); ok {
					evt.Usage = mapToUsage(u)
				}
			}
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
				evt.Block = domain.ContentBlockFromMap(cb)
			}
		case "message_delta":
			if u, ok := raw["usage"].(map[string]any); ok {
				evt.Usage = mapToUsage(u)
			}
		}

		ch <- evt
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Error: fmt.Errorf("sse read: %w", err)}
	}
}

func mapToUsage(m map[string]any) *domain.Usage {
	u := &domain.Usage{}
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
