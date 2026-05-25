package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"minicode/internal/domain"
)

// AskUserPrompt shown when the agent asks the user a question.
type AskUserPrompt struct {
	pending   bool
	question  string
	options   []domain.AskOption
	multi     bool
	selected  []bool
	current   int
	resolve   chan string
}

func (a *AskUserPrompt) Active() bool { return a.pending }

func (a *AskUserPrompt) Activate(question string, options []domain.AskOption, multi bool, resolve chan string) {
	a.pending = true
	a.question = question
	a.options = options
	a.multi = multi
	a.selected = make([]bool, len(options))
	a.current = 0
	a.resolve = resolve
}

func (a *AskUserPrompt) Update(msg tea.KeyMsg) (handled bool) {
	if !a.pending {
		return false
	}
	switch msg.Type {
	case tea.KeyUp:
		a.current = (a.current - 1 + len(a.options)) % len(a.options)
	case tea.KeyDown:
		a.current = (a.current + 1) % len(a.options)
	case tea.KeySpace:
		if a.multi {
			a.selected[a.current] = !a.selected[a.current]
		}
	case tea.KeyEnter:
		var result string
		if a.multi {
			var sel []string
			for i, s := range a.selected {
				if s {
					sel = append(sel, a.options[i].Label)
				}
			}
			result = strings.Join(sel, ",")
		} else {
			result = a.options[a.current].Label
		}
		a.pending = false
		if a.resolve != nil {
			a.resolve <- result
		}
		return true
	case tea.KeyEsc:
		a.pending = false
		if a.resolve != nil {
			a.resolve <- ""
		}
		return true
	}
	return false
}

func (a *AskUserPrompt) View(width int) string {
	if !a.pending {
		return ""
	}

	// Question box with yellow rounded border
	qBorder := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("3")).
		Padding(0, 1)
	questionBox := qBorder.Render(a.question)

	// Options list
	var optLines []string
	for i, opt := range a.options {
		marker := "  "
		label := styleDim.Render(opt.Label)
		if i == a.current {
			marker = styleInputArrow.Render(">")
			label = styleHeaderCyan.Render(opt.Label)
		}
		if a.multi {
			chk := " "
			if a.selected[i] {
				chk = "x"
			}
			marker = "[" + chk + "]"
		}
		desc := ""
		if opt.Description != "" {
			desc = "  " + styleDim.Render(opt.Description)
		}
		optLines = append(optLines, fmt.Sprintf("%s %s%s", marker, label, desc))
	}

	// Footer
	footer := styleDim.Render("↑↓ navigate")
	if a.multi {
		footer += styleDim.Render("  Space toggle")
	}
	footer += styleDim.Render("  Enter accept  Esc cancel")

	// Options box with gray border
	oBorder := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("8")).
		Padding(0, 1)
	optionsBox := oBorder.Render(strings.Join(optLines, "\n") + "\n" + footer)

	return questionBox + "\n" + optionsBox
}
