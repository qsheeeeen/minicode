package tui

import (
	"fmt"
	"strings"
	"github.com/charmbracelet/lipgloss"
)

func (m *TUIModel) renderInput() string {
	if m.permPending {
		return styleToolCall.Render(fmt.Sprintf("[Permission] %s [y=yes / n=no / a=yes to all]", m.permText))
	}

	if m.askPending {
		// Yellow round border for question (matches TS)
		questionBox := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("3")).Padding(0, 1).Render(m.askQuestion)

		// Align option labels to same width
		maxLabel := 0
		for _, opt := range m.askOptions {
			if len(opt.Label) > maxLabel {
				maxLabel = len(opt.Label)
			}
		}
		var optLines []string
		for i, opt := range m.askOptions {
			arrow := "  "
			label := styleDim.Render(opt.Label)
			if i == m.askCurrent {
				arrow = styleInputArrow.Render("> ")
				label = styleHeaderCyan.Render(opt.Label)
			}
			marker := ""
			if m.askMulti {
				chk := " "
				if m.askSelected[i] {
					chk = "x"
				}
				marker = "[" + chk + "] "
			}
			desc := ""
			if opt.Description != "" {
				desc = "  " + styleDim.Render(opt.Description)
			}
			optLines = append(optLines, fmt.Sprintf("%s%s%s%s", arrow, marker, label, desc))
		}
		footer := styleDim.Render("↑↓ navigate")
		if m.askMulti {
			footer += styleDim.Render("  Space toggle")
		}
		footer += styleDim.Render("  Enter accept  Esc cancel")

		// Gray single border for options (matches TS)
		selectBox := lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1).Render(
			strings.Join(optLines, "\n") + "\n" + footer,
		)

		return questionBox + "\n" + selectBox
	}

	// Mode: select UI using bubbles/list
	if m.selectMode != "" {
		return m.selectList.View()
	}

	prefix := styleInputArrow.Render("> ")
	if m.streaming {
		prefix = m.spinner.View() + " "
	}

	inputView := prefix + m.input.View()
	mainInput := styleInputBorder.Width(m.width - 2).Render(inputView)

	if len(m.suggestions) > 0 && !m.streaming {
		var lines []string
		for i, s := range m.suggestions {
			arrow := "  "
			style := styleDim
			if i == m.selectedIdx {
				arrow = styleInputArrow.Render("> ")
				style = styleHeaderCyan
			}
			desc := s.Description
			if idx := strings.Index(desc, "\n"); idx != -1 {
				desc = desc[:idx]
			}
			line := fmt.Sprintf("%s%s %s", arrow, style.Render("/"+s.Name), styleDim.Render(desc))
			lines = append(lines, line)
		}
		suggestions := "\n" + strings.Join(lines, "\n") + "\n " + styleDim.Render("↑↓ navigate  Tab accept")
		return mainInput + suggestions + "\n"
	}

	return mainInput + "\n"
}
