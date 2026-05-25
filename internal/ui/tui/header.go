package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"minicode/internal/agent"
)

// HeaderModel holds the state for the top header bar.
type HeaderModel struct {
	promptFiles []string
	sessions    []agent.AgentSession
	activeID    string
}

func (h *HeaderModel) View(width int) string {
	line1 := styleHeaderCyan.Render("Mini Code") + styleDim.Render(" v"+Version)
	if len(h.promptFiles) > 0 {
		line1 += styleDim.Render(" | " + strings.Join(h.promptFiles, ", "))
	}

	var agentStr string
	if len(h.sessions) > 1 {
		indicator := h.activeID
		if indicator == "1" {
			indicator = "M"
		}
		agentStr = styleHeaderCyan.Render(fmt.Sprintf("[%s]", indicator))
	}

	leftWidth := lipgloss.Width(line1)
	rightWidth := lipgloss.Width(agentStr)
	spaces := width - leftWidth - rightWidth - 2
	if spaces < 1 {
		spaces = 1
	}

	return " " + line1 + strings.Repeat(" ", spaces) + agentStr + " \n\n"
}
