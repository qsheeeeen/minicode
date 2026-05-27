package llm

import (
	"context"
	"log/slog"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
	"minicode/internal/domain"
)

// Tool is a tool definition sent to the API.
type Tool struct {
	Name        string
	Description string
	InputSchema map[string]any
}

// StreamEvent represents a parsed event from the streaming SDK.
type StreamEvent struct {
	Type  string
	Index int
	Delta string
	Block domain.ContentBlock
	Usage *domain.Usage
	Error error
}

// ChatOptions contains optional parameters for a chat request.
type ChatOptions struct {
	Model           string
	MaxTokens       int64
	System          string
	ThinkingEnabled bool
	ThinkingBudget  int64
	Signal          <-chan struct{}
}

// Client wraps the official Anthropic SDK.
type Client struct {
	sdk    anthropic.Client
	logger *slog.Logger
}

// NewClient creates a new Anthropic API client.
func NewClient(apiKey, baseURL string) Client {
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return Client{sdk: anthropic.NewClient(opts...), logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
}

// Chat sends a non-streaming request and returns the first text content block.
func (c Client) Chat(ctx context.Context, messages []domain.MessageParam, opts ChatOptions) (string, error) {
	if opts.Model == "" {
		opts.Model = "claude-sonnet-4-5"
	}
	if opts.MaxTokens == 0 {
		opts.MaxTokens = 100
	}

	c.logger.Info("chat request", "model", opts.Model, "max_tokens", opts.MaxTokens, "messages", len(messages))

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(opts.Model),
		MaxTokens: opts.MaxTokens,
	}

	if opts.System != "" {
		params.System = []anthropic.TextBlockParam{{Text: opts.System}}
	}

	sdkMsgs := make([]anthropic.MessageParam, len(messages))
	for i, m := range messages {
		role := anthropic.MessageParamRoleUser
		if m.Role == "assistant" {
			role = anthropic.MessageParamRoleAssistant
		}
		sdkMsgs[i] = anthropic.MessageParam{Role: role, Content: toSDKContent(m.Content)}
	}
	params.Messages = sdkMsgs

	msg, err := c.sdk.Messages.New(ctx, params)
	if err != nil {
		c.logger.Error("chat request failed", "model", opts.Model, "error", err)
		return "", err
	}

	c.logger.Info("chat response received", "model", opts.Model, "content_blocks", len(msg.Content), "input_tokens", msg.Usage.InputTokens, "output_tokens", msg.Usage.OutputTokens)
	for _, block := range msg.Content {
		if block.Type == "text" {
			return block.Text, nil
		}
	}
	return "", nil
}

// ChatStream sends a streaming request and returns a channel of events.
func (c Client) ChatStream(ctx context.Context, messages []domain.MessageParam, tools []Tool, opts ChatOptions) (<-chan StreamEvent, error) {
	if opts.Model == "" {
		opts.Model = "claude-sonnet-4-5"
	}
	if opts.MaxTokens == 0 {
		opts.MaxTokens = 8192
	}
	if opts.ThinkingBudget == 0 {
		opts.ThinkingBudget = 4096
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(opts.Model),
		MaxTokens: opts.MaxTokens,
	}

	if opts.System != "" {
		params.System = []anthropic.TextBlockParam{{Text: opts.System}}
	}

	// Map messages
	sdkMsgs := make([]anthropic.MessageParam, len(messages))
	for i, m := range messages {
		role := anthropic.MessageParamRoleUser
		if m.Role == "assistant" {
			role = anthropic.MessageParamRoleAssistant
		}
		sdkMsgs[i] = anthropic.MessageParam{Role: role, Content: toSDKContent(m.Content)}
	}
	params.Messages = sdkMsgs

	// Map tools
	if len(tools) > 0 {
		sdkTools := make([]anthropic.ToolUnionParam, len(tools))
		for i, t := range tools {
			sdkTools[i] = anthropic.ToolUnionParam{OfTool: &anthropic.ToolParam{
				Name:        t.Name,
				Description: param.NewOpt(t.Description),
				InputSchema: anthropic.ToolInputSchemaParam{Properties: t.InputSchema["properties"], Required: toStringSlice(t.InputSchema["required"])},
			}}
		}
		params.Tools = sdkTools
	}

	// Thinking config
	if opts.ThinkingEnabled {
		params.Thinking = anthropic.ThinkingConfigParamUnion{
			OfEnabled: &anthropic.ThinkingConfigEnabledParam{BudgetTokens: opts.ThinkingBudget},
		}
	} else {
		params.Thinking = anthropic.ThinkingConfigParamUnion{
			OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{},
		}
	}

	c.logger.Info("chat stream request", "model", opts.Model, "max_tokens", opts.MaxTokens, "messages", len(messages), "tools", len(tools), "thinking", opts.ThinkingEnabled)

	ch := make(chan StreamEvent, 64)
	stream := c.sdk.Messages.NewStreaming(ctx, params)

	go func() {
		defer close(ch)
		send := func(evt StreamEvent) bool {
			select {
			case ch <- evt:
				return true
			case <-ctx.Done():
				return false
			}
		}
		for stream.Next() {
			select {
			case <-ctx.Done():
				return
			case <-opts.Signal:
				return
			default:
			}

			evt := stream.Current()
			switch variant := evt.AsAny().(type) {
			case anthropic.ContentBlockStartEvent:
				cb := variant.ContentBlock
				block := domain.ContentBlock{Type: cb.Type}
				switch cb.Type {
				case "thinking":
					block.Thinking = cb.Thinking
				case "text":
					block.Text = cb.Text
				case "tool_use":
					block.ID = cb.ID
					block.Name = cb.Name
					block.Input = cb.Input
				}
				if !send(StreamEvent{Type: "content_block_start", Index: int(variant.Index), Block: block}) {
					return
				}

			case anthropic.ContentBlockDeltaEvent:
				switch variant.Delta.Type {
				case "thinking_delta":
					if !send(StreamEvent{Type: "thinking", Index: int(variant.Index), Delta: variant.Delta.Thinking}) {
						return
					}
				case "text_delta":
					if !send(StreamEvent{Type: "text", Index: int(variant.Index), Delta: variant.Delta.Text}) {
						return
					}
				case "input_json_delta":
					if !send(StreamEvent{Type: "input_json_delta", Index: int(variant.Index), Delta: variant.Delta.PartialJSON}) {
						return
					}
				}

			case anthropic.ContentBlockStopEvent:
				if !send(StreamEvent{Type: "content_block_stop", Index: int(variant.Index)}) {
					return
				}

			case anthropic.MessageDeltaEvent:
				if !send(StreamEvent{
					Type:  "message_delta",
					Usage: &domain.Usage{OutputTokens: int(variant.Usage.OutputTokens)},
				}) {
					return
				}

			case anthropic.MessageStartEvent:
				if !send(StreamEvent{
					Type: "message_start",
					Usage: &domain.Usage{
						InputTokens:              int(variant.Message.Usage.InputTokens),
						OutputTokens:             int(variant.Message.Usage.OutputTokens),
						CacheCreationInputTokens: int(variant.Message.Usage.CacheCreationInputTokens),
						CacheReadInputTokens:     int(variant.Message.Usage.CacheReadInputTokens),
					},
				}) {
					return
				}

			default:
				// Ignore unhandled event types (e.g., MessageStopEvent is auto-generated by SDK)
			}
		}
		if err := stream.Err(); err != nil {
			c.logger.Error("chat stream error", "model", opts.Model, "error", err)
			send(StreamEvent{Error: err})
		} else {
			c.logger.Info("chat stream completed", "model", opts.Model)
		}
	}()

	return ch, nil
}

func toSDKContent(content any) []anthropic.ContentBlockParamUnion {
	switch c := content.(type) {
	case string:
		return []anthropic.ContentBlockParamUnion{{OfText: &anthropic.TextBlockParam{Text: c}}}
	case []domain.ContentBlock:
		blocks := make([]anthropic.ContentBlockParamUnion, len(c))
		for i, b := range c {
			switch b.Type {
			case "text":
				blocks[i] = anthropic.ContentBlockParamUnion{OfText: &anthropic.TextBlockParam{Text: b.Text}}
			case "thinking":
				blocks[i] = anthropic.ContentBlockParamUnion{OfThinking: &anthropic.ThinkingBlockParam{Thinking: b.Thinking, Signature: ""}}
			case "tool_use":
				blocks[i] = anthropic.ContentBlockParamUnion{OfToolUse: &anthropic.ToolUseBlockParam{ID: b.ID, Name: b.Name, Input: b.Input}}
			case "tool_result":
				blocks[i] = anthropic.ContentBlockParamUnion{OfToolResult: &anthropic.ToolResultBlockParam{
					ToolUseID: b.ToolUseID,
					Content: []anthropic.ToolResultBlockParamContentUnion{
						{OfText: &anthropic.TextBlockParam{Text: b.Content}},
					},
				}}
			}
		}
		return blocks
	}
	return nil
}

func toStringSlice(v any) []string {
	if v == nil {
		return nil
	}
	switch arr := v.(type) {
	case []string:
		return arr
	case []any:
		out := make([]string, len(arr))
		for i, s := range arr {
			if str, ok := s.(string); ok {
				out[i] = str
			}
		}
		return out
	}
	return nil
}
