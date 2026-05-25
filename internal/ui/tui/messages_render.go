package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	"minicode/internal/agent"
	"minicode/internal/domain"
)

// ViewportModel holds the state for the message display area.
type ViewportModel struct {
	viewport viewport.Model
	messages []domain.DisplayMessage
}

// Render returns the viewport content string.
func (vp *ViewportModel) Render() string {
	if len(vp.messages) == 0 {
		return "\n\n" + styleDim.Render("Type a message to start...") + "\n"
	}

	var lines []string
	for _, msg := range vp.messages {
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
			call := formatToolCall(msg)
			lines = append(lines, styleToolCall.Render(call))
			if msg.ToolOutput != "" {
				lines = append(lines, formatToolOutput(msg)...)
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
	return strings.Join(lines, "\n") + "\n"
}

func formatToolCall(msg domain.DisplayMessage) string {
	switch msg.ToolName {
	case "Read":
		path, _ := msg.ToolInput["path"].(string)
		parts := []string{path}
		if offset, ok := msg.ToolInput["offset"].(float64); ok && offset > 0 {
			parts = append(parts, fmt.Sprintf("offset: %.0f", offset))
		}
		if limit, ok := msg.ToolInput["limit"].(float64); ok && limit > 0 {
			parts = append(parts, fmt.Sprintf("limit: %.0f", limit))
		}
		return fmt.Sprintf("Read(%s)", strings.Join(parts, ", "))
	case "Write":
		path, _ := msg.ToolInput["path"].(string)
		content, _ := msg.ToolInput["content"].(string)
		n := 0
		if content != "" {
			n = len(strings.Split(content, "\n"))
		}
		return fmt.Sprintf("Write(%s, %d lines)", path, n)
	case "Edit":
		path, _ := msg.ToolInput["path"].(string)
		return fmt.Sprintf("Edit(%s)", path)
	case "Bash":
		cmd, _ := msg.ToolInput["command"].(string)
		return fmt.Sprintf("Bash(%s)", cmd)
	case "SubAgent":
		task, _ := msg.ToolInput["task"].(string)
		if len(task) > 30 {
			task = task[:30] + "..."
		}
		return fmt.Sprintf("SubAgent(%s)", task)
	case "ActivateSkill":
		name, _ := msg.ToolInput["name"].(string)
		return fmt.Sprintf("ActivateSkill(%s)", name)
	case "AskUser":
		question, _ := msg.ToolInput["question"].(string)
		return fmt.Sprintf("AskUser(%q)", question)
	case "SetModel":
		tier, _ := msg.ToolInput["tier"].(string)
		return fmt.Sprintf("SetModel(Tier %s)", tier)
	default:
		return fmt.Sprintf("%s(%v)", msg.ToolName, msg.ToolInput)
	}
}

func formatToolOutput(msg domain.DisplayMessage) []string {
	if msg.ToolName == "Read" {
		nl := strings.Count(msg.ToolOutput, "\n") + 1
		return []string{styleDim.Render(fmt.Sprintf("Read %d lines, %d chars", nl, len(msg.ToolOutput)))}
	}
	if msg.ToolName == "ActivateSkill" {
		return []string{styleDim.Render("Loaded")}
	}
	if msg.ToolName == "Edit" {
		var out []string
		for _, line := range strings.Split(msg.ToolOutput, "\n") {
			if strings.Contains(line, " + ") {
				out = append(out, styleGreen.Render(line))
			} else if strings.Contains(line, " - ") {
				out = append(out, styleRed.Render(line))
			} else {
				out = append(out, styleDim.Render(line))
			}
		}
		return out
	}
	var out []string
	for _, line := range strings.Split(msg.ToolOutput, "\n") {
		out = append(out, styleDim.Render(line))
	}
	return out
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
					dm := domain.DisplayMessage{Role: domain.RoleTool, ToolName: b.Name, SlotID: b.ID}
					if input, ok := b.Input.(map[string]any); ok {
						dm.ToolInput = input
					}
					if res, ok := results[b.ID]; ok {
						dm.ToolOutput = res
					}
					out = append(out, dm)
				}
			}
		}

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
