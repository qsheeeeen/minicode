package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

// SystemPrompt is the base system prompt.
const SystemPrompt = `你是一个交互式 CLI 编程智能体，帮助用户完成软件工程任务。请使用以下指令和可用工具来协助用户。

# 指南：
- 使用用户的语言
- 使用 Bash 进行文件操作，如 ls、grep、find
- 编辑文件前先用 Read 查看
- 使用 Edit 进行精确修改（旧文本必须完全匹配）
- 仅在创建新文件或完全重写时使用 Write
- 总结操作时直接输出纯文本——不要用 cat 或 Bash 来展示你做了什么
- 回复保持简洁严谨——不要使用比喻
- 操作文件时清晰展示文件路径
- 在操作前评估影响范围，和用户确认不可逆的操作，用户的确认单次生效
- 你可以在单次响应中调用多个工具
- 适当地并行来提高效率`

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
	ThinkingEnabled           bool
	ThinkingBudget            int
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
