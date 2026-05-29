package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

// SystemPrompt is the base system prompt.
const SystemPrompt = `You are an interactive CLI coding agent that helps users with software engineering tasks. Use the following instructions and available tools to assist the user.

# Guidelines:
- Always think and respond in the language the user first spoke at the start of the conversation
- Use Bash for file operations like ls, grep, find
- Read files with Read before editing
- Use Write only when creating new files or fully rewriting
- When summarizing actions, output plain text directly - do not use cat or Bash to show what you did
- Keep responses concise and precise - do not use metaphors
- Show file paths clearly when operating on files
- Assess impact before operations and confirm irreversible actions with the user; confirmations are single-use
- You may call multiple tools in a single response
- Parallelize appropriately to improve efficiency
- Use read-only subagents for parallel investigation tasks: code exploration, code review, debugging research, documentation generation, and dependency analysis. Do not use subagents for simple lookups or when a direct grep/find suffices.`

// MessageParam is an LLM-facing message.
type MessageParam struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
	Display string `json:"_display,omitempty"` // user-facing override, stripped before LLM call
}

// ContentBlock is a single block in an assistant message or a tool result.
type ContentBlock struct {
	Type      string `json:"type"` // "text" | "thinking" | "tool_use" | "tool_result"
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
}

// Usage tracks token consumption from the API response.
type Usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

// AgentConfig is the full agent configuration, shared between the agent and tools.
type AgentConfig struct {
	APIKey                    string
	BaseURL                   string
	Model                     string
	Provider                  string
	ContextLength             int
	CompressionThresholdRatio float64
	Effort                    string
	UserPrompt                string
	ExcludeTools              []string
	PermissionMode            PermissionMode
}

// PermissionMode defines how tool execution is gated.
type PermissionMode string

const (
	PermManual PermissionMode = "manual"
	PermYolo   PermissionMode = "yolo"
	PermAuto   PermissionMode = "auto"
)

// ToolResult is the structured return value from a tool execution.
type ToolResult struct {
	Output string
}

// AskOption is a single option presented to the user.
type AskOption struct {
	Label       string
	Description string
}

// DisplayRole categorises a display message for rendering.
type DisplayRole string

const (
	RoleUser     DisplayRole = "user"
	RoleText     DisplayRole = "text"
	RoleThinking DisplayRole = "thinking"
	RoleTool     DisplayRole = "tool"
	RoleStatus   DisplayRole = "status"
	RoleError    DisplayRole = "error"
)

// DisplayMessage is a render-ready message for the UI.
type DisplayMessage struct {
	Role        DisplayRole    `json:"role"`
	Content     string         `json:"content"`
	IsStreaming bool           `json:"isStreaming,omitempty"`
	ToolName    string         `json:"name,omitempty"`
	ToolInput   map[string]any `json:"input,omitempty"`
	ToolOutput  string         `json:"output,omitempty"`
	SlotID      string         `json:"slotId,omitempty"`
	Timestamp   *time.Time     `json:"timestamp,omitempty"`
}

// ContentBlockFromMap converts a raw map to a ContentBlock.
func ContentBlockFromMap(m map[string]any) ContentBlock {
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
	} else {
		cb.Input = m["input"]
	}
	if v, ok := m["tool_use_id"].(string); ok {
		cb.ToolUseID = v
	}
	if v, ok := m["content"].(string); ok {
		cb.Content = v
	}
	return cb
}

// JSONString converts any value to a JSON string.
func JSONString(v any) string {
	if v == nil {
		return "{}"
	}
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(data)
}

// ExtractResults scans message content for tool results.
func ExtractResults(content any, results map[string]string) {
	switch c := content.(type) {
	case []ContentBlock:
		for _, block := range c {
			if block.Type == "tool_result" {
				results[block.ToolUseID] = block.Content
			}
		}
	case []any:
		for _, b := range c {
			if block, ok := b.(map[string]any); ok {
				if block["type"] == "tool_result" {
					id, _ := block["tool_use_id"].(string)
					if id == "" {
						continue
					}
					switch v := block["content"].(type) {
					case string:
						results[id] = v
					default:
						if data, err := json.Marshal(v); err == nil {
							results[id] = string(data)
						}
					}
				}
			}
		}
	}
}
