package tui

import (
	"fmt"
	"strings"
	"minicode/internal/agent"
	"minicode/internal/domain"
)

func (m *TUIModel) renderMessages() string {
	if len(m.messages) == 0 {
		return "\n\n" + styleDim.Render("Type a message to start...") + "\n"
	}

	var lines []string
	for _, msg := range m.messages {
		// Match TS filtering: tool always, status only if (not applicable in Go), others only if content
		if msg.Role != domain.RoleTool && msg.Role != domain.RoleStatus && msg.Role != domain.RoleError && msg.Content == "" {
			continue
		}
		switch msg.Role {
		case domain.RoleUser:
			lines = append(lines, styleUserBg.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case domain.RoleText:
			lines = append(lines, strings.TrimSpace(msg.Content))
			lines = append(lines, "")
		case domain.RoleThinking:
			lines = append(lines, styleThinking.Render("Thinking"))
			lines = append(lines, styleDim.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case domain.RoleTool:
			var call string
			if msg.ToolName == "Read" {
				path, _ := msg.ToolInput["path"].(string)
				parts := []string{path}
				if offset, ok := msg.ToolInput["offset"].(float64); ok && offset > 0 {
					parts = append(parts, fmt.Sprintf("offset: %.0f", offset))
				}
				if limit, ok := msg.ToolInput["limit"].(float64); ok && limit > 0 {
					parts = append(parts, fmt.Sprintf("limit: %.0f", limit))
				}
				call = fmt.Sprintf("Read(%s)", strings.Join(parts, ", "))
			} else if msg.ToolName == "Write" {
				path, _ := msg.ToolInput["path"].(string)
				content, _ := msg.ToolInput["content"].(string)
				lines := 0
				if content != "" {
					lines = len(strings.Split(content, "\n"))
				}
				call = fmt.Sprintf("Write(%s, %d lines)", path, lines)
			} else if msg.ToolName == "Edit" {
				path, _ := msg.ToolInput["path"].(string)
				call = fmt.Sprintf("Edit(%s)", path)
			} else if msg.ToolName == "Bash" {
				cmd, _ := msg.ToolInput["command"].(string)
				call = fmt.Sprintf("Bash(%s)", cmd)
			} else if msg.ToolName == "SubAgent" {
				task, _ := msg.ToolInput["task"].(string)
				if len(task) > 30 {
					task = task[:30] + "..."
				}
				call = fmt.Sprintf("SubAgent(%s)", task)
			} else if msg.ToolName == "ActivateSkill" {
				name, _ := msg.ToolInput["name"].(string)
				call = fmt.Sprintf("ActivateSkill(%s)", name)
			} else if msg.ToolName == "AskUser" {
				question, _ := msg.ToolInput["question"].(string)
				call = fmt.Sprintf("AskUser(%q)", question)
			} else if msg.ToolName == "SetModel" {
				tier, _ := msg.ToolInput["tier"].(string)
				call = fmt.Sprintf("SetModel(Tier %s)", tier)
			} else {
				call = fmt.Sprintf("%s(%v)", msg.ToolName, msg.ToolInput)
			}

			lines = append(lines, styleToolCall.Render(call))
			if msg.ToolOutput != "" {
				// Read summarises: "Read N lines, M chars" (matches TS)
				if msg.ToolName == "Read" {
					nl := strings.Count(msg.ToolOutput, "\n") + 1
					lines = append(lines, styleDim.Render(fmt.Sprintf("Read %d lines, %d chars", nl, len(msg.ToolOutput))))
				} else if msg.ToolName == "ActivateSkill" {
					lines = append(lines, styleDim.Render("Loaded"))
				} else if msg.ToolName == "Edit" {
					for _, line := range strings.Split(msg.ToolOutput, "\n") {
						if strings.Contains(line, " + ") {
							lines = append(lines, styleGreen.Render(line))
						} else if strings.Contains(line, " - ") {
							lines = append(lines, styleRed.Render(line))
						} else {
							lines = append(lines, styleDim.Render(line))
						}
					}
				} else {
					for _, line := range strings.Split(msg.ToolOutput, "\n") {
						lines = append(lines, styleDim.Render(line))
					}
				}
			}
			lines = append(lines, "")
		case domain.RoleStatus:
			lines = append(lines, styleDim.Render("— "+msg.Content))
			lines = append(lines, "")
		case domain.RoleError:
			lines = append(lines, styleErrorMsg.Render("✕ "+msg.Content))
			lines = append(lines, "")
		}
	}
	result := strings.Join(lines, "\n") + "\n"

	// Multi-agent switch hint (matches TS)
	if len(m.sessions) > 1 {
		result += styleYellow.Render("Ctrl+O: switch agent") + "\n"
	}

	return result
}

// ToDisplayMessages converts current state to render-ready DisplayMessages.
func ToDisplayMessages(turns []domain.MessageParam, statuses []agent.StatusMessage, streaming bool) []domain.DisplayMessage {
	var out []domain.DisplayMessage
	results := make(map[string]string)

	for ti, t := range turns {
		domain.ExtractResults(t.Content, results)

		switch t.Role {
		case "user":
			content := t.Display
			if content == "" {
				if s, ok := t.Content.(string); ok {
					content = s
				}
			}
			if content != "" {
				out = append(out, domain.DisplayMessage{Role: domain.RoleUser, Content: content})
			}
		case "assistant":
			var blocks []domain.ContentBlock
			switch c := t.Content.(type) {
			case []domain.ContentBlock:
				blocks = c
			case []any:
				for _, b := range c {
					if m, ok := b.(map[string]any); ok {
						blocks = append(blocks, domain.ContentBlockFromMap(m))
					}
				}
			}

			for bi, b := range blocks {
				isLast := ti == len(turns)-1 && bi == len(blocks)-1
				isStr := streaming && isLast

				switch b.Type {
				case "text":
					out = append(out, domain.DisplayMessage{Role: domain.RoleText, Content: b.Text, IsStreaming: isStr})
				case "thinking":
					out = append(out, domain.DisplayMessage{Role: domain.RoleThinking, Content: b.Thinking, IsStreaming: isStr})
				case "tool_use":
					msg := domain.DisplayMessage{Role: domain.RoleTool, ToolName: b.Name, SlotID: b.ID}
					if input, ok := b.Input.(map[string]any); ok {
						msg.ToolInput = input
					}
					// Check if we have a result for this tool yet
					if res, ok := results[b.ID]; ok {
						msg.ToolOutput = res
					}
					out = append(out, msg)
				}
			}
		}

		// Inject statuses that happened after this turn
		for _, s := range statuses {
			if s.TurnIndex == ti+1 {
				out = append(out, domain.DisplayMessage{
					Role:      s.Role,
					Content:   s.Content,
					Timestamp: &s.Timestamp,
				})
			}
		}
	}
	return out
}
