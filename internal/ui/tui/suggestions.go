package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	icmd "minicode/internal/commands"
)

// Suggestions is the command autocomplete dropdown.
type Suggestions struct {
	items       []icmd.Command
	selectedIdx int
}

func (s *Suggestions) IsActive() bool { return len(s.items) > 0 }

func (s *Suggestions) Set(items []icmd.Command) {
	s.items = items
	if s.selectedIdx >= len(s.items) {
		s.selectedIdx = 0
	}
}

func (s *Suggestions) Clear() {
	s.items = nil
	s.selectedIdx = 0
}

func (s *Suggestions) Up() {
	s.selectedIdx = (s.selectedIdx - 1 + len(s.items)) % len(s.items)
}

func (s *Suggestions) Down() {
	s.selectedIdx = (s.selectedIdx + 1) % len(s.items)
}

func (s *Suggestions) Accept(textareaValue string) string {
	if s.selectedIdx >= 0 && s.selectedIdx < len(s.items) {
		return "/" + s.items[s.selectedIdx].Name + " "
	}
	return textareaValue
}

// View renders suggestions below the input box.
func (s *Suggestions) View(mainInput string) string {
	if len(s.items) == 0 {
		return mainInput
	}

	var lines []string
	for i, cmd := range s.items {
		arrow := "  "
		style := styleDim
		if i == s.selectedIdx {
			arrow = styleInputArrow.Render("> ")
			style = styleHeaderCyan
		}
		desc := cmd.Description
		if idx := strings.Index(desc, "\n"); idx != -1 {
			desc = desc[:idx]
		}
		lines = append(lines, fmt.Sprintf("%s%s %s", arrow, style.Render("/"+cmd.Name), styleDim.Render(desc)))
	}


	box := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("8")).
		Padding(0, 1).
		Render(strings.Join(lines, "\n") + "\n" + styleDim.Render("↑↓ navigate  Tab accept"))

	return mainInput + "\n" + box
}
