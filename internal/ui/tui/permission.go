package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// PermissionPrompt shown when a tool requires user approval.
type PermissionPrompt struct {
	pending  bool
	text     string
	resolve  chan string
}

func (p *PermissionPrompt) Active() bool { return p.pending }

func (p *PermissionPrompt) Activate(text string, resolve chan string) {
	p.pending = true
	p.text = text
	p.resolve = resolve
}

func (p *PermissionPrompt) Update(msg tea.KeyMsg) (handled bool) {
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
	p.pending = false
	if p.resolve != nil {
		p.resolve <- res
	}
	return true
}

func (p *PermissionPrompt) View(width int) string {
	border := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("3")).
		Padding(0, 1)

	title := styleToolCall.Render("Permission Required")
	detail := styleDim.Render(p.text)
	actions := styleDim.Render("[y] yes  ") + styleDim.Render("[n] no  ") + styleYellow.Render("[a] yes to all")

	return border.Width(width - 2).Render(
		fmt.Sprintf("%s\n\n%s\n\n%s", title, detail, actions),
	) + "\n"
}
