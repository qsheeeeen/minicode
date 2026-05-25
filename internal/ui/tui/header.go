package tui

import "strings"

// HeaderModel holds the state for the top header bar.
type HeaderModel struct {
	promptFiles []string
}

func (h *HeaderModel) View(width int) string {
	line1 := styleHeaderCyan.Render("Mini Code") + styleDim.Render(" v"+Version)
	if len(h.promptFiles) > 0 {
		line1 += styleDim.Render(" | " + strings.Join(h.promptFiles, ", "))
	}
	return " " + line1 + " \n\n"
}
