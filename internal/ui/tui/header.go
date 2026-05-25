package tui

import (
	"fmt"
	"strings"
	"github.com/charmbracelet/lipgloss"
)

func (m *TUIModel) renderHeader() string {
	line1 := styleHeaderCyan.Render("Mini Code") + styleDim.Render(" v"+Version)
	if len(m.promptFiles) > 0 {
		line1 += styleDim.Render(" | " + strings.Join(m.promptFiles, ", "))
	}

	var agentStr string
	if len(m.sessions) > 1 {
		indicator := m.activeID
		if indicator == "1" {
			indicator = "M"
		}
		agentStr = styleHeaderCyan.Render(fmt.Sprintf("[%s]", indicator))
	}

	// Calculate right alignment
	leftWidth := lipgloss.Width(line1)
	rightWidth := lipgloss.Width(agentStr)
	spaces := m.width - leftWidth - rightWidth - 2 // -2 for padding
	if spaces < 1 {
		spaces = 1
	}

	return " " + line1 + strings.Repeat(" ", spaces) + agentStr + " \n\n"
}

func (m *TUIModel) activeAgentId() string {
	return m.activeID
}
