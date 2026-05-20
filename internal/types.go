// Package internal implements the core of minicode: types, LLM client, tools, agent loop, and session persistence.
package internal

import "time"

// ---- LLM-layer types (Anthropic API format) ----

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

// ---- Display-layer types ----

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

// DisplayMessage is a render-ready message for the TUI.
type DisplayMessage struct {
	Role        DisplayRole  `json:"role"`
	Content     string       `json:"content"`
	IsStreaming bool         `json:"isStreaming,omitempty"`
	ToolName    string       `json:"name,omitempty"`
	ToolInput   map[string]any `json:"input,omitempty"`
	ToolOutput  string       `json:"output,omitempty"`
	SlotID      string       `json:"slotId,omitempty"`
	Timestamp   *time.Time   `json:"timestamp,omitempty"`
}

// StatusMessage is a UI-only message (not sent to LLM).
type StatusMessage struct {
	Role      DisplayRole
	Content   string
	TurnIndex int
	Timestamp time.Time
}

// ToDisplayMessages converts LLM turns + statuses into render-ready DisplayMessages.
func ToDisplayMessages(turns []MessageParam, statuses []StatusMessage, streaming bool) []DisplayMessage {
	results := make(map[string]string)
	for _, turn := range turns {
		if turn.Role == "user" {
			extractResults(turn.Content, results)
		}
	}

	byTurnIndex := make(map[int][]StatusMessage)
	for _, s := range statuses {
		byTurnIndex[s.TurnIndex] = append(byTurnIndex[s.TurnIndex], s)
	}

	var display []DisplayMessage
	for _, s := range byTurnIndex[0] {
		display = append(display, statusToDisplay(s))
	}

	for i, turn := range turns {
		switch turn.Role {
		case "user":
			content := ""
			if s, ok := turn.Content.(string); ok {
				content = s
			}
			if turn.Display != "" {
				content = turn.Display
			}
			if content != "" {
				display = append(display, DisplayMessage{Role: RoleUser, Content: content})
			}
		case "assistant":
			var blocks []ContentBlock
			switch c := turn.Content.(type) {
			case []ContentBlock:
				blocks = c
			case []any:
				for _, raw := range c {
					if m, ok := raw.(map[string]any); ok {
						blocks = append(blocks, mapToContentBlock(m))
					}
				}
			}
			for _, block := range blocks {
				switch block.Type {
				case "thinking":
					display = append(display, DisplayMessage{Role: RoleThinking, Content: block.Thinking})
				case "text":
					display = append(display, DisplayMessage{Role: RoleText, Content: block.Text})
				case "tool_use":
					input, _ := block.Input.(map[string]any)
					if input == nil {
						input = map[string]any{}
					}
					display = append(display, DisplayMessage{
						Role:       RoleTool,
						ToolName:   block.Name,
						ToolInput:  input,
						ToolOutput: results[block.ID],
						SlotID:     block.ID,
					})
				}
			}
		}
		for _, s := range byTurnIndex[i+1] {
			display = append(display, statusToDisplay(s))
		}
	}

	for _, s := range statuses {
		if s.TurnIndex > len(turns) {
			display = append(display, statusToDisplay(s))
		}
	}

	if streaming {
		for i := len(display) - 1; i >= 0; i-- {
			m := &display[i]
			if (m.Role == RoleText || m.Role == RoleThinking) && m.Content != "" {
				m.IsStreaming = true
				break
			}
		}
	}

	return display
}

func statusToDisplay(s StatusMessage) DisplayMessage {
	return DisplayMessage{
		Role:      s.Role,
		Content:   s.Content,
		Timestamp: &s.Timestamp,
	}
}

func mapToContentBlock(m map[string]any) ContentBlock {
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
	cb.Input = m["input"]
	if v, ok := m["tool_use_id"].(string); ok {
		cb.ToolUseID = v
	}
	if v, ok := m["content"].(string); ok {
		cb.Content = v
	}
	return cb
}

func extractResults(content any, results map[string]string) {
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
					if content, ok := block["content"].(string); ok {
						if id, ok := block["tool_use_id"].(string); ok {
							results[id] = content
						}
					}
				}
			}
		}
	}
}
