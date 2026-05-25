package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	icmd "minicode/internal/commands"
	"minicode/internal/domain"
)

// InputModel holds the state for the bottom input area.
type InputModel struct {
	textarea  textarea.Model
	spinner   spinner.Model
	streaming bool

	// Permission prompt
	permPending bool
	permText    string
	permResolve chan string

	// AskUser prompt
	askPending  bool
	askQuestion string
	askOptions  []domain.AskOption
	askMulti    bool
	askSelected []bool
	askCurrent  int
	askResolve  chan string

	// Command autocomplete
	suggestions []icmd.Command
	selectedIdx int
}

// handlePermKey processes a keypress during permission prompt.
func (in *InputModel) handlePermKey(msg tea.KeyMsg) (resolved bool) {
	var res string
	switch msg.String() {
	case "y":
		res = "yes"
	case "n", "esc":
		res = "no"
	case "a":
		res = "yolo"
	default:
		return false
	}
	in.permPending = false
	if in.permResolve != nil {
		in.permResolve <- res
	}
	return true
}

// handleAskKey processes a keypress during ask-user prompt.
func (in *InputModel) handleAskKey(msg tea.KeyMsg) (resolved bool) {
	switch msg.Type {
	case tea.KeyUp:
		in.askCurrent = (in.askCurrent - 1 + len(in.askOptions)) % len(in.askOptions)
	case tea.KeyDown:
		in.askCurrent = (in.askCurrent + 1) % len(in.askOptions)
	case tea.KeySpace:
		if in.askMulti {
			in.askSelected[in.askCurrent] = !in.askSelected[in.askCurrent]
		}
	case tea.KeyEnter:
		var result string
		if in.askMulti {
			var selected []string
			for i, s := range in.askSelected {
				if s {
					selected = append(selected, in.askOptions[i].Label)
				}
			}
			result = strings.Join(selected, ",")
		} else {
			result = in.askOptions[in.askCurrent].Label
		}
		in.askPending = false
		if in.askResolve != nil {
			in.askResolve <- result
		}
		return true
	case tea.KeyEsc:
		in.askPending = false
		if in.askResolve != nil {
			in.askResolve <- ""
		}
		return true
	}
	return false
}

// View renders the input area.
func (in *InputModel) View(width int) string {
	if in.permPending {
		return styleToolCall.Render(fmt.Sprintf("[Permission] %s [y=yes / n=no / a=yes to all]", in.permText))
	}

	if in.askPending {
		questionBox := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("3")).Padding(0, 1).Render(in.askQuestion)

		maxLabel := 0
		for _, opt := range in.askOptions {
			if len(opt.Label) > maxLabel {
				maxLabel = len(opt.Label)
			}
		}
		var optLines []string
		for i, opt := range in.askOptions {
			arrow := "  "
			label := styleDim.Render(opt.Label)
			if i == in.askCurrent {
				arrow = styleInputArrow.Render("> ")
				label = styleHeaderCyan.Render(opt.Label)
			}
			marker := ""
			if in.askMulti {
				chk := " "
				if in.askSelected[i] {
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
		if in.askMulti {
			footer += styleDim.Render("  Space toggle")
		}
		footer += styleDim.Render("  Enter accept  Esc cancel")

		selectBox := lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1).Render(
			strings.Join(optLines, "\n") + "\n" + footer,
		)
		return questionBox + "\n" + selectBox
	}

	prefix := styleInputArrow.Render("> ")
	if in.streaming {
		prefix = in.spinner.View() + " "
	}

	inputView := prefix + in.textarea.View()
	mainInput := styleInputBorder.Width(width - 2).Render(inputView)

	if len(in.suggestions) > 0 && !in.streaming {
		var lines []string
		for i, s := range in.suggestions {
			arrow := "  "
			style := styleDim
			if i == in.selectedIdx {
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
